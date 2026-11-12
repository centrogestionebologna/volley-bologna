// Versione "copia e incolla" del Worker volley-bologna-push.
// Unisce worker/src/firestore.js + worker/src/webpush.js + worker/src/index.js
// in un unico modulo, per crearlo dal dashboard Cloudflare (nessun import).
//
// Dove incollarlo: Cloudflare -> Workers & Pages -> Create -> Worker
//   nome: volley-bologna-push
//   contenuto: tutto questo file (un solo file, nessun altro modulo)
// Variabili (Settings -> Variables and Secrets):
//   FIREBASE_PROJECT_ID    = il tuo project id (testo semplice)
//   VAPID_PUBLIC_KEY       = chiave pubblica VAPID (testo semplice)
//   VAPID_SUBJECT          = mailto:tua-email@example.com (testo semplice)
//   FIREBASE_CLIENT_EMAIL  = ...@....iam.gserviceaccount.com (secret)
//   FIREBASE_PRIVATE_KEY   = -----BEGIN PRIVATE KEY----- ... (secret)
//   VAPID_PRIVATE_KEY      = chiave privata VAPID (secret)
//   MAINTENANCE_SECRET     = una stringa lunga a caso (secret)
// Trigger: Cron -> * * * * *
//
// Le sorgenti da modificare restano in worker/src/: se cambiano, rigenera questo file.

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

/**
 * Web Push con Web Crypto: cifratura aes128gcm (RFC 8291/8188) e VAPID (RFC 8292).
 *
 * Scritto a mano senza dipendenze npm così il Worker resta pubblicabile anche
 * incollando un unico file nel dashboard Cloudflare (niente bundler).
 * I nomi degli header seguono quello che si aspettano FCM, Apple e autopush:
 *   Authorization: vapid t=<jwt>, k=<chiave pubblica>
 */

const encoder = new TextEncoder();
const RECORD_SIZE = 4096;
const HEADER_SIZE = 21 + 65;
// 17 = delimitatore di padding (0x02) + tag GCM
const MAX_PLAINTEXT = RECORD_SIZE - HEADER_SIZE - 17;

function base64UrlToBytes(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBytes(...chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

/** Cifra il payload per una singola subscription (endpoint + keys.p256dh/auth). */
async function encryptNotification(subscription, payload) {
  if (payload.byteLength > MAX_PLAINTEXT) {
    throw new Error(`Payload di ${payload.byteLength} byte: il massimo è ${MAX_PLAINTEXT}.`);
  }
  const clientPublicBytes = base64UrlToBytes(subscription?.keys?.p256dh);
  const authSecret = base64UrlToBytes(subscription?.keys?.auth);
  if (clientPublicBytes.byteLength !== 65) throw new Error('Chiave p256dh non valida.');
  if (authSecret.byteLength < 16) throw new Error('Segreto auth non valido.');

  const clientPublicKey = await crypto.subtle.importKey(
    'raw',
    clientPublicBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const localKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const localPublicBytes = new Uint8Array(
    await crypto.subtle.exportKey('raw', localKeys.publicKey)
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: clientPublicKey },
      localKeys.privateKey,
      256
    )
  );

  // RFC 8291 §3.4: IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info\0" || ua_public || as_public)
  const keyInfo = concatBytes(
    encoder.encode('WebPush: info\0'),
    clientPublicBytes,
    localPublicBytes
  );
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  // Un solo record: payload + 0x02, poi zeri fino alla dimensione massima.
  const padded = new Uint8Array(MAX_PLAINTEXT + 1);
  padded.set(payload);
  padded[payload.byteLength] = 0x02;

  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM', length: 128 }, false, [
    'encrypt',
  ]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cekKey, padded)
  );

  // RFC 8188 §2.1: salt(16) | rs(4) | idlen(1) | keyid(65) | record cifrato
  const body = new Uint8Array(HEADER_SIZE + ciphertext.byteLength);
  body.set(salt, 0);
  new DataView(body.buffer).setUint32(16, RECORD_SIZE, false);
  body[20] = localPublicBytes.byteLength;
  body.set(localPublicBytes, 21);
  body.set(ciphertext, HEADER_SIZE);
  return body;
}

const vapidCache = new Map();

/** JWT VAPID firmato ES256, in cache per audience (12 ore). */
async function vapidAuthorization(env, endpoint) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    throw new Error('VAPID non configurato sul Worker.');
  }
  const url = new URL(endpoint);
  if (url.protocol !== 'https:') throw new Error('Endpoint push non https.');
  const audience = url.origin;

  const cached = vapidCache.get(audience);
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.header;

  const publicKeyBytes = base64UrlToBytes(env.VAPID_PUBLIC_KEY);
  if (publicKeyBytes.byteLength !== 65) throw new Error('VAPID_PUBLIC_KEY non valida.');

  const key = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToBase64Url(publicKeyBytes.slice(1, 33)),
      y: bytesToBase64Url(publicKeyBytes.slice(33, 65)),
      d: bytesToBase64Url(base64UrlToBytes(env.VAPID_PRIVATE_KEY)),
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iat: now,
    aud: audience,
    exp: now + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'https://volley-bologna-community.example',
  };
  const unsigned = [
    bytesToBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))),
    bytesToBase64Url(encoder.encode(JSON.stringify(claims))),
  ].join('.');
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned))
  );

  const header = `vapid t=${unsigned}.${bytesToBase64Url(signature)}, k=${env.VAPID_PUBLIC_KEY}`;
  vapidCache.set(audience, { header, expiresAt: claims.exp * 1000 });
  return header;
}

function topicFor(tag) {
  const clean = String(tag || '').replace(/[^A-Za-z0-9_-]/g, '');
  return clean ? clean.slice(0, 32) : null;
}

/**
 * Invia una notifica a una subscription.
 * Ritorna lo status HTTP: 404/410 significa subscription scaduta.
 */
async function sendWebPush(env, subscription, message) {
  if (!subscription?.endpoint) throw new Error('Subscription senza endpoint.');
  const payload = encoder.encode(JSON.stringify(message));
  const body = await encryptNotification(subscription, payload);

  const headers = {
    authorization: await vapidAuthorization(env, subscription.endpoint),
    'content-encoding': 'aes128gcm',
    'content-type': 'application/octet-stream',
    ttl: '3600',
    urgency: 'high',
  };
  const topic = topicFor(message?.tag);
  if (topic) headers.topic = topic;

  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers,
    body,
  });
  return response.status;
}

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

  const matchId = match.path.split('/').pop();
  const waitlist = await db.query(`${match.path}/registrations`, {
    where: ['status', '==', 'waitlist'],
  });
  waitlist.sort((a, b) => (a.data.seq || 0) - (b.data.seq || 0));
  const next = waitlist.find((row) => row.id !== offer.uid);
  const expiredReg = await db.getDoc(`${match.path}/registrations/${offer.uid}`);
  // Se l'offerta nasce da una sostituzione, chi l'ha chiesta resta iscritto
  // finché qualcuno non accetta: i riferimenti vanno riportati sull'offerta successiva.
  const replacementFor = offer.replacementFor || null;
  const replacementRequestId = offer.replacementRequestId || null;

  const writes = [];
  const patch = {
    pendingOffer: null,
    pendingOfferUid: null,
    updatedAt: new Date(now),
    waitlistCount: fresh.data.waitlistCount || 0,
  };

  let logSeq = Number(fresh.data.logSeq) || 0;
  const pushLog = (type, text, uid, nickname) => {
    logSeq += 1;
    writes.push({
      update: {
        name: documentName(env, `matches/${matchId}/log/${String(logSeq).padStart(6, '0')}`),
        fields: toFields({
          seq: logSeq,
          at: new Date(now),
          type,
          text: String(text).slice(0, 160),
          uid: uid || null,
          nickname: nickname || '',
          actorId: null,
        }),
      },
    });
  };

  pushLog(
    'offer_expired',
    `Offerta a ${offer.nickname || 'una riserva'} scaduta`,
    offer.uid,
    offer.nickname || ''
  );

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
      ...(replacementFor ? { replacementFor, replacementRequestId } : {}),
    };
    patch.pendingOfferUid = next.id;
    pushLog('offer', `Posto offerto a ${next.data.nickname || 'una riserva'}`, next.id, next.data.nickname || '');
  }

  patch.logSeq = logSeq;
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
