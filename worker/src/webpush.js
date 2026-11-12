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
export async function encryptNotification(subscription, payload) {
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
export async function vapidAuthorization(env, endpoint) {
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
export async function sendWebPush(env, subscription, message) {
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
