import { serverTimestamp } from '../store/base';
import { toDate, dateKey, pad } from '../lib/format';
import { LIMITS } from '../config';
import { expirePendingOffer } from './matches';

const DAYS_AHEAD = 14;

function upcomingWeekdayDates(weekday, daysAhead = DAYS_AHEAD) {
  const dates = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  for (let i = 0; i <= daysAhead; i += 1) {
    if (cursor.getDay() === weekday) dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
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
  const cutoff = new Date(Date.now() - LIMITS.messageRetentionDays * 86400000);
  const groups = await storeApi.listDocs('groups', { limit: 200 });
  const paths = ['chats/general/messages', ...groups.map((group) => `groups/${group.id}/messages`)];
  let deleted = 0;

  for (const path of paths) {
    for (let round = 0; round < 20; round += 1) {
      const rows = await storeApi.listDocs(path, {
        where: [['createdAt', '<', cutoff]],
        limit: 100,
      });
      if (!rows.length) break;
      await Promise.all(rows.map((row) => storeApi.deleteDoc(`${path}/${row.id}`)));
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

    for (const day of upcomingWeekdayDates(rule.weekday)) {
      const startsAt = new Date(day);
      startsAt.setHours(Number.isFinite(hours) ? hours : 20, Number.isFinite(minutes) ? minutes : 0, 0, 0);
      if (startsAt.getTime() < Date.now() + 3600000) continue;

      const matchId = `${ruleDoc.id}_${dateKey(startsAt)}`;
      const existing = await storeApi.getDoc(`matches/${matchId}`);
      if (existing) continue;

      try {
        await storeApi.setDoc(`matches/${matchId}`, {
          title: rule.title,
          sport: rule.sport || 'indoor',
          startsAt,
          date: dateKey(startsAt),
          time: `${pad(startsAt.getHours())}:${pad(startsAt.getMinutes())}`,
          deadlineHours: rule.deadlineHours ?? 6,
          deadlineAt: new Date(startsAt.getTime() - (rule.deadlineHours ?? 6) * 3600000),
          gym: rule.gym,
          zone: rule.zone || '',
          cost: rule.cost || 0,
          level: rule.level,
          maxPlayers: rule.maxPlayers,
          ageBand: rule.ageBand,
          description: rule.description || '',
          organizerId: rule.organizerId,
          organizerNickname: rule.organizerNickname,
          confirmedCount: 0,
          waitlistCount: 0,
          registrationSeq: 0,
          pendingOffer: null,
          pendingOfferUid: null,
          status: 'open',
          recurringId: ruleDoc.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        created += 1;
      } catch (error) {
        // Se il cron e un altro processo creano lo stesso match, il secondo fallisce: ignorabile.
        console.warn('Pubblicazione ricorrenza saltata', matchId, error?.message);
      }
    }

    await storeApi.updateDoc(`recurringMatches/${ruleDoc.id}`, {
      lastPublishedDate: dateKey(new Date()),
    });
  }

  return created;
}

/** Esegue tutta la manutenzione periodica (equivalente al cron Cloudflare). */
export async function runScheduledMaintenance(storeApi) {
  const pendingOffers = await expireOverdueOffers(storeApi);
  const messagesDeleted = await purgeOldMessages(storeApi);
  const createdMatches = await publishRecurringMatches(storeApi);
  return { pendingOffers, messagesDeleted, createdMatches };
}
