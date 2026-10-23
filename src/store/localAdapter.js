import { buildSeed, DEMO_ACCOUNTS } from '../demo/seed';
import { SERVER_TS, docId, collectionOf, matchesWhere, applyOrderAndLimit } from './base';

const DB_KEY = 'vb_demo_db_v5';
const SESSION_KEY = 'vb_demo_session_v1';

const clone = (value) => (value == null ? value : structuredClone(value));

function resolveTimestamps(value) {
  if (value === SERVER_TS) return Date.now();
  if (Array.isArray(value)) return value.map(resolveTimestamps);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (val !== undefined) out[key] = resolveTimestamps(val);
    }
    return out;
  }
  return value;
}

function loadDb() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.docs) return parsed;
    }
  } catch {
    // storage non disponibile o corrotto: si riparte dal seed
  }
  const seeded = { docs: buildSeed(Date.now()) };
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(seeded));
  } catch {
    /* modalità privata senza storage: resta in memoria */
  }
  return seeded;
}

function rowsFrom(db, path, options = {}) {
  const where = options.where || [];
  const rows = [];
  for (const [fullPath, data] of Object.entries(db.docs)) {
    if (collectionOf(fullPath) !== path) continue;
    if (!matchesWhere(data, where)) continue;
    rows.push({ id: docId(fullPath), data });
  }
  return applyOrderAndLimit(rows, options.orderBy, options.limit).map((row) => ({
    id: row.id,
    data: clone(row.data),
  }));
}

export function createLocalBackend() {
  let db = loadDb();
  const listeners = new Set();
  let queue = Promise.resolve();

  const persist = () => {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
    } catch {
      /* ignora quota/storage */
    }
  };

  const notify = () => {
    persist();
    for (const listener of [...listeners]) listener();
  };

  const readOne = (source, path) => {
    const data = source.docs[path];
    return data ? { id: docId(path), data: clone(data) } : null;
  };

  const writeOne = (source, path, data, merge) => {
    const existing = merge ? source.docs[path] || {} : {};
    source.docs[path] = resolveTimestamps({ ...existing, ...data });
    return docId(path);
  };

  const store = {
    mode: 'demo',

    async getDoc(path) {
      return readOne(db, path);
    },

    async setDoc(path, data) {
      writeOne(db, path, data, false);
      notify();
      return docId(path);
    },

    async updateDoc(path, patch) {
      if (!db.docs[path]) throw new Error(`Documento inesistente: ${path}`);
      writeOne(db, path, patch, true);
      notify();
    },

    async deleteDoc(path) {
      delete db.docs[path];
      notify();
    },

    async addDoc(path, data) {
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      await store.setDoc(`${path}/${id}`, data);
      return id;
    },

    async listDocs(path, options = {}) {
      return rowsFrom(db, path, options);
    },

    async count(path, options = {}) {
      return rowsFrom(db, path, options).length;
    },

    subscribeDoc(path, callback) {
      let last = null;
      const run = () => {
        const next = readOne(db, path);
        const signature = JSON.stringify(next);
        if (signature === last) return;
        last = signature;
        callback(next);
      };
      listeners.add(run);
      queueMicrotask(run);
      return () => listeners.delete(run);
    },

    subscribeList(path, options, callback) {
      let last = null;
      const run = () => {
        const next = rowsFrom(db, path, options);
        const signature = JSON.stringify(next);
        if (signature === last) return;
        last = signature;
        callback(next);
      };
      listeners.add(run);
      queueMicrotask(run);
      return () => listeners.delete(run);
    },

    runTransaction(run) {
      const execute = queue.then(async () => {
        const working = clone(db);
        let changed = false;
        const tx = {
          async get(path) {
            return readOne(working, path);
          },
          async query(path, options = {}) {
            return rowsFrom(working, path, options);
          },
          set(path, data, options = {}) {
            writeOne(working, path, data, Boolean(options.merge));
            changed = true;
          },
          update(path, patch) {
            if (!working.docs[path]) throw new Error(`Documento inesistente: ${path}`);
            writeOne(working, path, patch, true);
            changed = true;
          },
          delete(path) {
            delete working.docs[path];
            changed = true;
          },
        };
        const result = await run(tx);
        if (changed) {
          db = working;
          notify();
        }
        return result;
      });
      queue = execute.then(
        () => undefined,
        () => undefined
      );
      return execute;
    },

    /** Solo demo: riporta i dati di esempio allo stato iniziale. */
    async resetDemoData() {
      db = { docs: buildSeed(Date.now()) };
      notify();
    },

    async runMaintenance() {
      const { runScheduledMaintenance } = await import('../services/maintenance');
      return runScheduledMaintenance(store, { force: true });
    },
  };

  const authListeners = new Set();
  const readSession = () => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const emit = () => {
    const user = readSession();
    for (const listener of [...authListeners]) listener(user);
  };

  const authApi = {
    mode: 'demo',
    currentUser: readSession(),
    subscribe(callback) {
      authListeners.add(callback);
      queueMicrotask(() => callback(readSession()));
      return () => authListeners.delete(callback);
    },
    async signIn() {
      throw new Error('In modalità demo scegli uno degli account qui sotto.');
    },
    async signInDemo(uid) {
      const account = DEMO_ACCOUNTS.find((item) => item.uid === uid);
      if (!account) throw new Error('Account demo sconosciuto');
      const user = { uid: account.uid, displayName: account.name, email: account.email, photoURL: '' };
      localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      emit();
      return user;
    },
    async signOut() {
      localStorage.removeItem(SESSION_KEY);
      emit();
    },
  };

  return { store, auth: authApi };
}
