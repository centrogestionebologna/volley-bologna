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

export function documentName(env, path) {
  return `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
}

export function toValue(value) {
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

export function toFields(object) {
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

export function fromFields(fields) {
  const data = {};
  for (const [key, value] of Object.entries(fields || {})) data[key] = fromValue(value);
  return data;
}

export function createFirestore(env) {
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
