// Versione "copia e incolla" del cron worker volley-bologna-cron.
// Generata unendo worker/src/firestore.js + worker/src/index.js in un unico
// modulo, per creare il Worker dal dashboard Cloudflare (nessun import).
//
// Dove incollarla: Cloudflare -> Workers & Pages -> Create -> Worker
//   nome: volley-bologna-cron
//   contenuto: tutto questo file (un solo file, nessun altro modulo)
// Variabili (Settings -> Variables and Secrets):
//   FIREBASE_PROJECT_ID    = il tuo project id (testo semplice)
//   FIREBASE_CLIENT_EMAIL  = ...@....iam.gserviceaccount.com (secret)
//   FIREBASE_PRIVATE_KEY   = -----BEGIN PRIVATE KEY----- ... (secret)
//   MAINTENANCE_SECRET     = una stringa lunga a caso (secret)
// Trigger: Cron -> */10 * * * *
//
// Le sorgenti da modificare restano worker/src/index.js e worker/src/firestore.js:
// se cambiano, rigenera questo file.

// ===== worker/src/firestore.js =====

/**
 * Client Firestore REST minimale per Cloudflare Workers.
 * Usa un service account (JWT RS256 firmato con Web Crypto) e le API REST v1.
 * Funziona nel piano gratuito e non richiede firebase-admin.
 */

const API = 'https://firestore.googleapis.com/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datastore';

let cachedToken = null;

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlText(text) {
  return base64Url(new TextEncoder().encode(text));
}

function pemToDer(pem) {
  const normalized = pem.replace(/\\n/g, '\n');
  const body = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.token;

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64UrlText(JSON.stringify(header))}.${base64UrlText(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(env.FIREBASE_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned)
  );
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token Google rifiutato (${response.status}): ${await response.text()}`);
  }
  const data = await response.json();
  cachedToken = { token: data.access_token, expiresAt: now + (data.expires_in || 3600) };
  return cachedToken.token;
}

function documentsUrl(env, path = '') {
  const base = `${API}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  return path ? `${base}/${path}` : base;
}

function documentName(env, path) {
  return `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
}

function toValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
  const fields = {};
  for (const [key, val] of Object.entries(value)) {
    if (val !== undefined) fields[key] = toValue(val);
  }
  return { mapValue: { fields } };
}

function toFields(object) {
  const fields = {};
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined) fields[key] = toValue(value);
  }
  return fields;
}

function fromValue(value) {
  if (!value) return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromValue);
  if ('mapValue' in value) return fromFields(value.mapValue.fields || {});
  return null;
}

function fromFields(fields) {
  const data = {};
  for (const [key, value] of Object.entries(fields || {})) data[key] = fromValue(value);
  return data;
}

function createFirestore(env) {
  const authHeaders = async () => ({
    authorization: `Bearer ${await getAccessToken(env)}`,
    'content-type': 'application/json',
  });

  async function getDoc(path) {
    const response = await fetch(documentsUrl(env, path), { headers: await authHeaders() });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Lettura ${path} fallita (${response.status}): ${await response.text()}`);
    const doc = await response.json();
    return {
      id: doc.name.split('/').pop(),
      path,
      data: fromFields(doc.fields),
      updateTime: doc.updateTime,
    };
  }

  async function query(collectionPath, { where, orderBy, limit } = {}) {
    const segments = collectionPath.split('/').filter(Boolean);
    const collectionId = segments.pop();
    const parent = segments.join('/');
    const structuredQuery = { from: [{ collectionId }] };

    if (where && where.length) {
      const [field, op, value] = where[0];
      const ops = {
        '==': 'EQUAL',
        '!=': 'NOT_EQUAL',
        '<': 'LESS_THAN',
        '<=': 'LESS_THAN_OR_EQUAL',
        '>': 'GREATER_THAN',
        '>=': 'GREATER_THAN_OR_EQUAL',
        'array-contains': 'ARRAY_CONTAINS',
        in: 'IN',
      };
      structuredQuery.where = {
        fieldFilter: {
          field: { fieldPath: field },
          op: ops[op] || 'EQUAL',
          value: toValue(value),
        },
      };
    }
    if (orderBy && orderBy.length) {
      structuredQuery.orderBy = orderBy.map(([field, dir = 'asc']) => ({
        field: { fieldPath: field },
        direction: dir === 'desc' ? 'DESCENDING' : 'ASCENDING',
      }));
    }
    if (typeof limit === 'number') structuredQuery.limit = limit;

    const url = `${documentsUrl(env, parent)}:runQuery`;
    const response = await fetch(url, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ structuredQuery }),
    });
    if (!response.ok) {
      throw new Error(`Query ${collectionPath} fallita (${response.status}): ${await response.text()}`);
    }
    const rows = await response.json();
    return rows
      .filter((row) => row.document)
      .map((row) => ({
        id: row.document.name.split('/').pop(),
        path: `${collectionPath}/${row.document.name.split('/').pop()}`,
        data: fromFields(row.document.fields),
        updateTime: row.document.updateTime,
      }));
  }

  async function commit(writes) {
    const response = await fetch(`${documentsUrl(env)}:commit`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ writes }),
    });
    if (!response.ok) {
      const error = new Error(`Commit fallito (${response.status}): ${await response.text()}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  return {
    getDoc,
    query,
    commit,
    /** Update parziale con precondition updateTime (concorrenza ottimistica). */
    async update(path, data, updateTime) {
      const write = {
        update: { name: documentsUrl(env, path).replace(`${API}/`, ''), fields: toFields(data) },
        updateMask: { fieldPaths: Object.keys(data) },
      };
      if (updateTime) write.currentDocument = { updateTime };
      return commit([write]);
    },
    async create(path, data) {
      return commit([
        {
          update: { name: documentsUrl(env, path).replace(`${API}/`, ''), fields: toFields(data) },
          currentDocument: { exists: false },
        },
      ]);
    },
    async remove(path) {
      return commit([{ delete: documentsUrl(env, path).replace(`${API}/`, '') }]);
    },
  };
}

// ===== worker/src/index.js =====

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
