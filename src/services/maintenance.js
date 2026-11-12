import { serverTimestamp } from '../store/base';
import { toDate, dateKey, pad } from '../lib/format';
import { LIMITS, retentionDaysForSetting } from '../config';
import { expirePendingOffer, regPath } from './matches';
import { queuePush } from './push';

const DAYS_AHEAD = 31;

function upcomingDates(daysAhead = DAYS_AHEAD) {
  const dates = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  for (let i = 0; i <= daysAhead; i += 1) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function matchesCadence(rule, date) {
  const frequency = rule.frequency || 'weekly';
  if (frequency === 'monthly') {
    const anchorDay = Number(rule.anchorDay) || 1;
    return date.getDate() === anchorDay;
  }
  if (frequency === 'biweekly') {
    const anchor = rule.anchorDate ? new Date(`${rule.anchorDate}T00:00:00`) : null;
    if (!anchor || Number.isNaN(anchor.getTime())) return date.getDay() === rule.weekday;
    const start = Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    const current = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.floor((current - start) / 604800000) % 2 === 0;
  }
  return date.getDay() === rule.weekday;
}

export async function expireOverdueOffers(storeApi) {
  const matches = await storeApi.listDocs('matches', {
    where: [['status', '==', 'open']],
    limit: 200,
  });
  let expired = 0;
  for (const match of matches) {
    const offer = match.data.pendingOffer;
    if (!offer) continue;
    const expiresAt = toDate(offer.expiresAt);
    if (!expiresAt || expiresAt.getTime() > Date.now()) continue;
    const changed = await expirePendingOffer(match.id);
    if (changed) expired += 1;
  }
  return expired;
}

export async function purgeOldMessages(storeApi) {
  const groups = await storeApi.listDocs('groups', { limit: 200 });
  const jobs = [
    { path: 'chats/general/messages', days: LIMITS.messageRetentionDays },
    ...groups.map((group) => ({
      path: `groups/${group.id}/messages`,
      days: retentionDaysForSetting(group.data.disappearingMessages),
    })),
  ];
  let deleted = 0;

  for (const job of jobs) {
    const cutoff = new Date(Date.now() - job.days * 86400000);
    for (let round = 0; round < 20; round += 1) {
      const rows = await storeApi.listDocs(job.path, {
        where: [['createdAt', '<', cutoff]],
        limit: 100,
      });
      if (!rows.length) break;
      await Promise.all(rows.map((row) => storeApi.deleteDoc(`${job.path}/${row.id}`)));
      deleted += rows.length;
    }
  }
  return deleted;
}

export async function publishRecurringMatches(storeApi) {
  const rules = await storeApi.listDocs('recurringMatches', {
    where: [['active', '==', true]],
    limit: 100,
  });
  let created = 0;

  for (const ruleDoc of rules) {
    const rule = ruleDoc.data;
    const [hours, minutes] = String(rule.time || '20:00')
      .split(':')
      .map((value) => Number(value));

    const daysAhead = rule.frequency === 'monthly' ? 31 : 14;
    for (const day of upcomingDates(daysAhead)) {
      if (!matchesCadence(rule, day)) continue;
      const startsAt = new Date(day);
      startsAt.setHours(Number.isFinite(hours) ? hours : 20, Number.isFinite(minutes) ? minutes : 0, 0, 0);
      if (startsAt.getTime() < Date.now() + 3600000) continue;

      const docId = `${ruleDoc.id}_${dateKey(startsAt)}`;
      const deadlineHours = rule.deadlineHours ?? 6;
      const matchData = {
        title: rule.title,
        sport: rule.sport || 'indoor',
        startsAt,
        date: dateKey(startsAt),
        time: `${pad(startsAt.getHours())}:${pad(startsAt.getMinutes())}`,
        deadlineHours,
        deadlineAt: new Date(startsAt.getTime() - deadlineHours * 3600000),
        gym: rule.gym,
        zone: rule.zone || '',
        cost: rule.cost || 0,
        level: rule.level,
        maxPlayers: rule.maxPlayers,
        ageBand: rule.ageBand,
        description: rule.description || '',
        organizerId: rule.organizerId,
        organizerNickname: rule.organizerNickname,
        groupId: rule.groupId || null,
        groupName: rule.groupName || '',
        groupVisibility: rule.groupVisibility || null,
        visibility: rule.visibility || 'public',
        confirmedCount: 1,
        waitlistCount: 0,
        registrationSeq: 1,
        organizerOptOut: false,
        pendingOffer: null,
        pendingOfferUid: null,
        status: 'open',
        recurringId: ruleDoc.id,
        chatMessageId: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      if (rule.approvalMode === 'founder') {
        const approvalId = docId;
        const existingMatch = await storeApi.getDoc(`matches/${docId}`);
        if (existingMatch) continue;
        const existingApproval = await storeApi.getDoc(`recurringApprovals/${approvalId}`);
        if (existingApproval) continue;
        try {
          await storeApi.setDoc(`recurringApprovals/${approvalId}`, {
            ruleId: ruleDoc.id,
            organizerId: rule.organizerId,
            organizerNickname: rule.organizerNickname || '',
            groupId: rule.groupId || null,
            groupName: rule.groupName || '',
            visibility: rule.visibility || 'public',
            status: 'pending',
            proposedAt: serverTimestamp(),
            match: matchData,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          console.warn('Riproposta non accodata', approvalId, error?.message);
        }
        continue;
      }

      const existing = await storeApi.getDoc(`matches/${docId}`);
      if (existing) continue;

      try {
        await storeApi.setDoc(`matches/${docId}`, matchData);
        created += 1;
        await queuePush({
          type: 'match',
          title: 'Nuovo match',
          body: `${matchData.title} · ${matchData.gym}`,
          url: `/match/${docId}`,
          tag: `match-${docId}`,
          audience: matchData.visibility === 'group-private' ? 'group' : 'all',
          groupId: matchData.groupId || null,
          matchId: docId,
          actorId: rule.organizerId,
        });
        if (rule.organizerId) {
          try {
            await storeApi.setDoc(regPath(docId, rule.organizerId), {
              uid: rule.organizerId,
              nickname: rule.organizerNickname || '',
              status: 'confirmed',
              seq: 1,
              createdAt: serverTimestamp(),
              confirmedAt: serverTimestamp(),
              offerExpiresAt: null,
            });
          } catch (error) {
            console.warn('Organizzatore non aggiunto alla ricorrenza', error?.message);
          }
        }
      } catch (error) {
        // Se il cron e un altro processo creano lo stesso match, il secondo fallisce: ignorabile.
        console.warn('Pubblicazione ricorrenza saltata', docId, error?.message);
      }
    }

    await storeApi.updateDoc(`recurringMatches/${ruleDoc.id}`, {
      lastPublishedDate: dateKey(new Date()),
    });
  }

  return created;
}

/** Rimuove gli accessi ospite scaduti (giocatori aggiunti alla chat per un match). */
export async function expireGuestMemberships(storeApi) {
  const groups = await storeApi.listDocs('groups', { limit: 200 });
  let removed = 0;

  for (const group of groups) {
    const guests = await storeApi.listDocs(`groups/${group.id}/members`, {
      where: [['role', '==', 'guest']],
      limit: 200,
    });
    const expired = guests.filter((row) => {
      const until = toDate(row.data.guestUntil);
      return until && until.getTime() < Date.now();
    });
    if (!expired.length) continue;

    await Promise.all(
      expired.map((row) => storeApi.deleteDoc(`groups/${group.id}/members/${row.id}`))
    );
    removed += expired.length;
    await storeApi.updateDoc(`groups/${group.id}`, {
      memberCount: Math.max(1, (group.data.memberCount || 1) - expired.length),
      updatedAt: serverTimestamp(),
    });
  }

  return removed;
}

/** Esegue tutta la manutenzione periodica (equivalente al cron Cloudflare). */
export async function runScheduledMaintenance(storeApi) {
  const pendingOffers = await expireOverdueOffers(storeApi);
  const messagesDeleted = await purgeOldMessages(storeApi);
  const expiredGuests = await expireGuestMemberships(storeApi);
  const createdMatches = await publishRecurringMatches(storeApi);
  return { pendingOffers, messagesDeleted, expiredGuests, createdMatches };
}
