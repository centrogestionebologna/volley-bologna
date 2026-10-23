import { createFirestore, documentName, toFields } from './firestore';

const DAY_MS = 86400000;
const OFFER_MS = 30 * 60000;
const RETENTION_DAYS = 30;
const pad = (value) => String(value).padStart(2, '0');

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
  const cutoff = new Date(now - RETENTION_DAYS * DAY_MS);
  const groups = await db.query('groups', { limit: 100 });
  const paths = ['chats/general/messages', ...groups.map((group) => `groups/${group.id}/messages`)];
  let deleted = 0;

  for (const path of paths) {
    for (let round = 0; round < 20; round += 1) {
      const rows = await db.query(path, { where: ['createdAt', '<', cutoff], limit: 100 });
      if (!rows.length) break;
      await db.commit(rows.map((row) => ({ delete: documentName(env, row.path) })));
      deleted += rows.length;
    }
  }
  return deleted;
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

    for (let offset = 0; offset <= 14; offset += 1) {
      const day = new Date(base + offset * DAY_MS);
      if (day.getUTCDay() !== data.weekday) continue;

      const startsAt = romeToUtc(
        day.getUTCFullYear(),
        day.getUTCMonth() + 1,
        day.getUTCDate(),
        hours,
        minutes
      );
      if (startsAt.getTime() < now + 3600000) continue;

      const matchId = `${rule.id}_${dateKey(day)}`;
      const existing = await db.getDoc(`matches/${matchId}`);
      if (existing) continue;

      const deadlineHours = data.deadlineHours ?? 6;
      try {
        await db.create(`matches/${matchId}`, {
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
          confirmedCount: 0,
          waitlistCount: 0,
          registrationSeq: 0,
          pendingOffer: null,
          pendingOfferUid: null,
          status: 'open',
          recurringId: rule.id,
          createdAt: new Date(now),
          updatedAt: new Date(now),
        });
        created += 1;
      } catch (error) {
        if (error.status !== 409 && error.status !== 400) {
          console.warn(`Ricorrenza ${matchId} non pubblicata`, error.message);
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
    offers: await expireOffers(env, db, now),
    messages: 0,
    matches: 0,
    skipped: [],
  };

  if (force || (rome.hour === 3 && rome.minute < 10)) {
    summary.messages = await purgeMessages(env, db, now);
  } else {
    summary.skipped.push('pulizia messaggi');
  }

  if (force || (rome.hour === 5 && rome.minute < 10)) {
    summary.matches = await publishRecurring(env, db, now);
  } else {
    summary.skipped.push('pubblicazione ricorrenze');
  }

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
        service: 'volley-bologna-cron',
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === '/' ) {
      return Response.json({
        service: 'Volley Bologna Community — cron worker',
        endpoints: ['/health', '/run?key=…'],
        cron: '*/10 * * * *',
      });
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
