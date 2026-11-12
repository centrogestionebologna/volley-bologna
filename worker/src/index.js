import { createFirestore, documentName, toFields } from './firestore';
import { sendWebPush } from './webpush';

const DAY_MS = 86400000;
const OFFER_MS = 30 * 60000;
const RETENTION_DAYS = 30;
const pad = (value) => String(value).padStart(2, '0');

function retentionDaysForGroup(group) {
  if (group.disappearingMessages === '24h') return 1;
  if (group.disappearingMessages === '7d') return 7;
  if (group.disappearingMessages === '90d') return 90;
  return RETENTION_DAYS;
}

function romeParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map = {};
  for (const part of parts) map[part.type] = part.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
  };
}

/** Converte un orario locale di Roma nell'istante UTC corrispondente. */
function romeToUtc(year, month, day, hour, minute) {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let i = 0; i < 2; i += 1) {
    const p = romeParts(new Date(guess));
    const actual = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += target - actual;
  }
  return new Date(guess);
}

function dateKey(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

async function expireOne(env, db, match, now) {
  const fresh = await db.getDoc(match.path);
  if (!fresh) return false;
  const offer = fresh.data.pendingOffer;
  if (!offer?.expiresAt) return false;
  if (new Date(offer.expiresAt).getTime() > now) return false;

  const waitlist = await db.query(`${match.path}/registrations`, {
    where: ['status', '==', 'waitlist'],
  });
  waitlist.sort((a, b) => (a.data.seq || 0) - (b.data.seq || 0));
  const next = waitlist.find((row) => row.id !== offer.uid);
  const expiredReg = await db.getDoc(`${match.path}/registrations/${offer.uid}`);

  const writes = [];
  const patch = {
    pendingOffer: null,
    pendingOfferUid: null,
    updatedAt: new Date(now),
    waitlistCount: fresh.data.waitlistCount || 0,
  };

  if (expiredReg && expiredReg.data.status === 'offered') {
    writes.push({ delete: documentName(env, `${match.path}/registrations/${offer.uid}`) });
    patch.waitlistCount = Math.max(0, patch.waitlistCount - 1);
  }

  if (next) {
    const expiresAt = new Date(now + OFFER_MS);
    writes.push({
      update: {
        name: documentName(env, `${match.path}/registrations/${next.id}`),
        fields: toFields({ status: 'offered', offerExpiresAt: expiresAt }),
      },
      updateMask: { fieldPaths: ['status', 'offerExpiresAt'] },
    });
    patch.pendingOffer = {
      uid: next.id,
      nickname: next.data.nickname || '',
      seq: next.data.seq || 0,
      expiresAt,
    };
    patch.pendingOfferUid = next.id;
  }

  writes.push({
    update: {
      name: documentName(env, match.path),
      fields: toFields(patch),
    },
    updateMask: { fieldPaths: Object.keys(patch) },
    currentDocument: { updateTime: fresh.updateTime },
  });

  await db.commit(writes);

  if (next) {
    const matchId = match.path.split('/').pop();
    await enqueuePush(db, {
      type: 'offer',
      title: 'Posto disponibile',
      body: `Hai 30 minuti per confermare il posto su ${fresh.data.title || 'questo match'}.`,
      url: `/match/${matchId}`,
      tag: `offerta-${matchId}`,
      audience: 'user',
      userId: next.id,
      matchId,
    });
  }

  return true;
}

async function expireOffers(env, db, now) {
  const matches = await db.query('matches', { where: ['status', '==', 'open'], limit: 200 });
  let count = 0;
  for (const match of matches) {
    const offer = match.data.pendingOffer;
    if (!offer?.expiresAt || new Date(offer.expiresAt).getTime() > now) continue;
    try {
      const changed = await expireOne(env, db, match, now);
      if (changed) count += 1;
    } catch (error) {
      // 409 = un client ha modificato il match nel frattempo: riproveremo al prossimo giro.
      console.warn(`Offerta ${match.id} non aggiornata`, error.message);
    }
  }
  return count;
}

async function purgeMessages(env, db, now) {
  const groups = await db.query('groups', { limit: 100 });
  const jobs = [
    { path: 'chats/general/messages', days: RETENTION_DAYS },
    ...groups.map((group) => ({
      path: `groups/${group.id}/messages`,
      days: retentionDaysForGroup(group.data),
    })),
  ];
  let deleted = 0;

  for (const job of jobs) {
    const cutoff = new Date(now - job.days * DAY_MS);
    for (let round = 0; round < 20; round += 1) {
      const rows = await db.query(job.path, { where: ['createdAt', '<', cutoff], limit: 100 });
      if (!rows.length) break;
      await db.commit(rows.map((row) => ({ delete: documentName(env, row.path) })));
      deleted += rows.length;
    }
  }
  return deleted;
}

/**
 * Ospiti temporanei: chi è stato approvato su una ricerca giocatori entra
 * nella chat del gruppo con guestUntil. A match finito la membership scade e
 * va rimossa, altrimenti l'accesso alla chat resterebbe aperto per sempre.
 */
async function expireGuests(env, db, now) {
  const groups = await db.query('groups', { limit: 100 });
  let removed = 0;

  for (const group of groups) {
    const guests = await db.query(`groups/${group.id}/members`, {
      where: ['role', '==', 'guest'],
      limit: 200,
    });
    const expired = guests.filter((row) => {
      const until = row.data.guestUntil;
      return until && new Date(until).getTime() < now;
    });
    if (!expired.length) continue;

    try {
      await db.commit(expired.map((row) => ({ delete: documentName(env, row.path) })));
      await db.update(`groups/${group.id}`, {
        memberCount: Math.max(1, (group.data.memberCount || 1) - expired.length),
        updatedAt: new Date(now),
      });
      removed += expired.length;
    } catch (error) {
      console.warn(`Ospiti scaduti non rimossi da ${group.id}`, error.message);
    }
  }

  return removed;
}

// ── Notifiche push ─────────────────────────────────────────────────────────

const PUSH_BATCH = 20;
const PUSH_MAX_SENDS = 80;

function pushJobId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function enqueuePush(db, job) {
  try {
    await db.create(`pushJobs/${pushJobId()}`, {
      type: String(job.type || 'system').slice(0, 32),
      title: String(job.title || 'Volley Bologna Community').slice(0, 120),
      body: String(job.body || '').slice(0, 240),
      url: String(job.url || '/').slice(0, 200),
      tag: String(job.tag || '').slice(0, 32),
      audience: job.audience || 'all',
      groupId: job.groupId || null,
      userId: job.userId || null,
      matchId: job.matchId || null,
      actorId: job.actorId || null,
      createdAt: new Date(),
    });
  } catch (error) {
    console.warn('Notifica non accodata', error.message);
  }
}

async function loadSubscriptions(db, uids) {
  const unique = [...new Set(uids.filter(Boolean))].slice(0, 200);
  const docs = [];
  for (let index = 0; index < unique.length; index += 25) {
    const chunk = unique.slice(index, index + 25);
    const rows = await Promise.all(chunk.map((uid) => db.getDoc(`pushSubscriptions/${uid}`)));
    for (const row of rows) {
      if (row && row.data?.devices && Object.keys(row.data.devices).length) docs.push(row);
    }
  }
  return docs;
}

async function recipientsFor(db, job) {
  if (job.audience === 'user') {
    return loadSubscriptions(db, [job.userId]);
  }
  if (job.audience === 'match') {
    if (!job.matchId) return [];
    const registrations = await db.query(`matches/${job.matchId}/registrations`, { limit: 200 });
    return loadSubscriptions(
      db,
      registrations
        .filter((row) => row.data.status === 'confirmed' || row.data.status === 'offered')
        .map((row) => row.id)
    );
  }
  if (job.audience === 'group') {
    if (!job.groupId) return [];
    const members = await db.query(`groups/${job.groupId}/members`, {
      where: ['status', '==', 'active'],
      limit: 200,
    });
    return loadSubscriptions(db, members.map((row) => row.id));
  }
  const rows = await db.query('pushSubscriptions', { limit: 500 });
  return rows.filter((row) => row.data?.devices && Object.keys(row.data.devices).length);
}

async function dropDevices(db, dead) {
  const byUser = new Map();
  for (const { uid, deviceId } of dead) {
    if (!byUser.has(uid)) byUser.set(uid, new Set());
    byUser.get(uid).add(deviceId);
  }
  for (const [uid, deviceIds] of byUser) {
    try {
      const row = await db.getDoc(`pushSubscriptions/${uid}`);
      if (!row) continue;
      const devices = { ...(row.data.devices || {}) };
      for (const id of deviceIds) delete devices[id];
      await db.update(`pushSubscriptions/${uid}`, { devices, updatedAt: new Date() }, row.updateTime);
    } catch (error) {
      console.warn(`Subscription scadute non rimosse per ${uid}`, error.message);
    }
  }
}

async function dispatchPushQueue(env, db) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return { skipped: 'VAPID non configurato' };
  }

  const jobs = await db.query('pushJobs', { orderBy: [['createdAt', 'asc']], limit: PUSH_BATCH });
  const summary = { jobs: jobs.length, sent: 0, failed: 0 };
  const dead = [];

  for (const job of jobs) {
    if (summary.sent >= PUSH_MAX_SENDS) break;
    const data = job.data;
    try {
      const subscriptions = await recipientsFor(db, data);
      const message = {
        title: data.title || 'Volley Bologna Community',
        body: data.body || '',
        url: data.url || '/',
        tag: data.tag || undefined,
      };
      for (const row of subscriptions) {
        if (data.actorId && row.id === data.actorId) continue;
        for (const [deviceId, device] of Object.entries(row.data.devices || {})) {
          if (summary.sent >= PUSH_MAX_SENDS) break;
          if (!device?.endpoint) continue;
          summary.sent += 1;
          try {
            const status = await sendWebPush(env, device, message);
            if (status === 404 || status === 410) dead.push({ uid: row.id, deviceId });
          } catch (error) {
            summary.failed += 1;
            console.warn(`Push non inviata (${job.id})`, error.message);
          }
        }
      }
    } catch (error) {
      summary.failed += 1;
      console.warn(`Notifica ${job.id} non processata`, error.message);
    }
    try {
      await db.remove(`pushJobs/${job.id}`);
    } catch (error) {
      console.warn(`Notifica ${job.id} non rimossa`, error.message);
    }
  }

  if (dead.length) await dropDevices(db, dead);
  return summary;
}

function recurringOccurs(data, day) {
  const frequency = data.frequency || 'weekly';
  if (frequency === 'monthly') {
    return day.getUTCDate() === (Number(data.anchorDay) || 1);
  }
  if (frequency === 'biweekly') {
    const anchor = data.anchorDate ? Date.parse(`${data.anchorDate}T00:00:00Z`) : NaN;
    if (!Number.isFinite(anchor)) return day.getUTCDay() === data.weekday;
    return Math.floor((day.getTime() - anchor) / (7 * DAY_MS)) % 2 === 0;
  }
  return day.getUTCDay() === data.weekday;
}

async function publishRecurring(env, db, now) {
  const rules = await db.query('recurringMatches', { where: ['active', '==', true], limit: 100 });
  const today = romeParts(new Date(now));
  const base = Date.UTC(today.year, today.month - 1, today.day);
  let created = 0;

  for (const rule of rules) {
    const data = rule.data;
    const [rawHours, rawMinutes] = String(data.time || '20:00')
      .split(':')
      .map(Number);
    const hours = Number.isFinite(rawHours) ? rawHours : 20;
    const minutes = Number.isFinite(rawMinutes) ? rawMinutes : 0;

    const daysAhead = data.frequency === 'monthly' ? 31 : 14;
    for (let offset = 0; offset <= daysAhead; offset += 1) {
      const day = new Date(base + offset * DAY_MS);
      if (!recurringOccurs(data, day)) continue;

      const startsAt = romeToUtc(
        day.getUTCFullYear(),
        day.getUTCMonth() + 1,
        day.getUTCDate(),
        hours,
        minutes
      );
      if (startsAt.getTime() < now + 3600000) continue;

      const docId = `${rule.id}_${dateKey(day)}`;
      const deadlineHours = data.deadlineHours ?? 6;
      const matchData = {
        title: data.title || `Volley a ${data.gym}`,
        sport: data.sport || 'indoor',
        startsAt,
        date: dateKey(day),
        time: `${pad(hours)}:${pad(minutes)}`,
        deadlineHours,
        deadlineAt: new Date(startsAt.getTime() - deadlineHours * 3600000),
        gym: data.gym || '',
        zone: data.zone || '',
        cost: data.cost || 0,
        level: data.level || 'intermedio',
        maxPlayers: data.maxPlayers || 12,
        ageBand: data.ageBand || 'universitari',
        description: data.description || '',
        organizerId: data.organizerId,
        organizerNickname: data.organizerNickname || '',
        groupId: data.groupId || null,
        groupName: data.groupName || '',
        groupVisibility: data.groupVisibility || null,
        visibility: data.visibility || 'public',
        confirmedCount: 1,
        waitlistCount: 0,
        registrationSeq: 1,
        organizerOptOut: false,
        pendingOffer: null,
        pendingOfferUid: null,
        status: 'open',
        recurringId: rule.id,
        chatMessageId: null,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      };

      if (data.approvalMode === 'founder') {
        const existingMatch = await db.getDoc(`matches/${docId}`);
        if (existingMatch) continue;
        const existingApproval = await db.getDoc(`recurringApprovals/${docId}`);
        if (existingApproval) continue;
        try {
          await db.create(`recurringApprovals/${docId}`, {
            ruleId: rule.id,
            organizerId: data.organizerId,
            organizerNickname: data.organizerNickname || '',
            groupId: data.groupId || null,
            groupName: data.groupName || '',
            visibility: data.visibility || 'public',
            status: 'pending',
            proposedAt: new Date(now),
            match: matchData,
            createdAt: new Date(now),
            updatedAt: new Date(now),
          });
          await enqueuePush(db, {
            type: 'approval',
            title: 'Riproposta da approvare',
            body: `${matchData.title} · ${matchData.gym}`,
            url: '/organizzatore',
            tag: `riproposta-${docId}`,
            audience: 'user',
            userId: data.organizerId,
            matchId: docId,
          });
        } catch (error) {
          if (error.status !== 409) {
            console.warn(`Riproposta ${docId} non accodata`, error.message);
          }
        }
        continue;
      }

      const existing = await db.getDoc(`matches/${docId}`);
      if (existing) continue;

      try {
        await db.create(`matches/${docId}`, matchData);
        created += 1;
        await enqueuePush(db, {
          type: 'match',
          title: 'Nuovo match',
          body: `${matchData.title} · ${matchData.gym}`,
          url: `/match/${docId}`,
          tag: `match-${docId}`,
          audience: matchData.visibility === 'group-private' ? 'group' : 'all',
          groupId: matchData.groupId,
          matchId: docId,
        });
        if (data.organizerId) {
          try {
            await db.create(`matches/${docId}/registrations/${data.organizerId}`, {
              uid: data.organizerId,
              nickname: data.organizerNickname || '',
              status: 'confirmed',
              seq: 1,
              createdAt: new Date(now),
              confirmedAt: new Date(now),
              offerExpiresAt: null,
            });
          } catch (regError) {
            if (regError.status !== 409) {
              console.warn(`Organizzatore non aggiunto a ${docId}`, regError.message);
            }
          }
        }
      } catch (error) {
        if (error.status !== 409 && error.status !== 400) {
          console.warn(`Ricorrenza ${docId} non pubblicata`, error.message);
        }
      }
    }

    try {
      await db.update(rule.path, { lastPublishedDate: dateKey(new Date(base)) }, rule.updateTime);
    } catch (error) {
      console.warn(`lastPublishedDate non aggiornata per ${rule.id}`, error.message);
    }
  }

  return created;
}

async function runAll(env, { force = false } = {}) {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    throw new Error('Configurazione Firebase mancante sul Worker (project id, client email, private key).');
  }
  const db = createFirestore(env);
  const now = Date.now();
  const rome = romeParts(new Date(now));

  const summary = {
    offers: 0,
    messages: 0,
    guests: 0,
    matches: 0,
    push: null,
    skipped: [],
  };

  // Il cron gira ogni minuto: le offerte scadute si controllano ogni 10 minuti
  // per non moltiplicare le letture su Firestore.
  if (force || rome.minute % 10 === 0) {
    summary.offers = await expireOffers(env, db, now);
  } else {
    summary.skipped.push('offerte scadute');
  }

  if (force || (rome.hour === 3 && rome.minute === 0)) {
    summary.messages = await purgeMessages(env, db, now);
  } else {
    summary.skipped.push('pulizia messaggi');
  }

  if (force || (rome.hour === 4 && rome.minute === 0)) {
    summary.guests = await expireGuests(env, db, now);
  } else {
    summary.skipped.push('ospiti scaduti');
  }

  if (force || (rome.hour === 5 && rome.minute === 0)) {
    summary.matches = await publishRecurring(env, db, now);
  } else {
    summary.skipped.push('pubblicazione ricorrenze');
  }

  // Sempre in coda: le notifiche create qui sopra partono nello stesso giro.
  summary.push = await dispatchPushQueue(env, db);

  return summary;
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runAll(env).then(
        (summary) => console.log('volley-cron', JSON.stringify(summary)),
        (error) => console.error('volley-cron errore', error.stack || error.message)
      )
    );
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        service: 'volley-bologna-push',
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === '/') {
      return Response.json({
        service: 'Volley Bologna Community — push e manutenzione',
        endpoints: ['/health', '/push?key=…', '/run?key=…'],
        cron: '* * * * *',
      });
    }

    if (url.pathname === '/push') {
      const key = url.searchParams.get('key') || request.headers.get('x-maintenance-secret');
      if (!env.MAINTENANCE_SECRET || key !== env.MAINTENANCE_SECRET) {
        return Response.json({ error: 'Non autorizzato' }, { status: 401 });
      }
      try {
        const db = createFirestore(env);
        const summary = await dispatchPushQueue(env, db);
        return Response.json({ ok: true, summary });
      } catch (error) {
        return Response.json({ ok: false, error: error.message }, { status: 500 });
      }
    }

    if (url.pathname === '/run') {
      const key = url.searchParams.get('key') || request.headers.get('x-maintenance-secret');
      if (!env.MAINTENANCE_SECRET || key !== env.MAINTENANCE_SECRET) {
        return Response.json({ error: 'Non autorizzato' }, { status: 401 });
      }
      try {
        const summary = await runAll(env, { force: true });
        return Response.json({ ok: true, summary });
      } catch (error) {
        return Response.json({ ok: false, error: error.message }, { status: 500 });
      }
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },
};
