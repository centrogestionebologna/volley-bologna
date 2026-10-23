import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
} from 'firebase/auth';
import {
  initializeFirestore,
  collection,
  doc,
  getDoc as fsGetDoc,
  getDocs,
  getCountFromServer,
  setDoc as fsSetDoc,
  updateDoc as fsUpdateDoc,
  deleteDoc as fsDeleteDoc,
  addDoc as fsAddDoc,
  query,
  where as fsWhere,
  orderBy as fsOrderBy,
  limit as fsLimit,
  onSnapshot,
  runTransaction,
  serverTimestamp as fsServerTimestamp,
} from 'firebase/firestore';
import { SERVER_TS, docId } from './base';

function getFirebaseApp(config) {
  if (getApps().length) return getApp();
  return initializeApp(config);
}

/** Converte ricorsivamente la sentinella SERVER_TS nel serverTimestamp di Firestore. */
function encode(value) {
  if (value === SERVER_TS) return fsServerTimestamp();
  if (Array.isArray(value)) return value.map((item) => encode(item));
  if (value instanceof Date) return value;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (val !== undefined) out[key] = encode(val);
    }
    return out;
  }
  return value;
}

function buildQuery(db, path, { where = [], orderBy, limit } = {}) {
  const constraints = [];
  for (const [field, op, value] of where) {
    if (value === undefined) throw new Error(`Filtro non valido su "${field}": valore undefined`);
    constraints.push(fsWhere(field, op, encode(value)));
  }
  const orders = !orderBy ? [] : Array.isArray(orderBy[0]) ? orderBy : [orderBy];
  for (const [field, dir = 'asc'] of orders) constraints.push(fsOrderBy(field, dir));
  if (typeof limit === 'number') constraints.push(fsLimit(limit));
  return query(collection(db, path), ...constraints);
}

export function createFirestoreBackend(config) {
  const app = getFirebaseApp(config);
  const db = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    experimentalAutoDetectLongPolling: true,
  });
  const auth = getAuth(app);

  const store = {
    mode: 'firebase',

    async getDoc(path) {
      const snap = await fsGetDoc(doc(db, path));
      return snap.exists() ? { id: snap.id, data: snap.data() } : null;
    },

    async setDoc(path, data, options = {}) {
      await fsSetDoc(doc(db, path), encode(data), options.merge ? { merge: true } : undefined);
      return docId(path);
    },

    async updateDoc(path, patch) {
      await fsUpdateDoc(doc(db, path), encode(patch));
    },

    async deleteDoc(path) {
      await fsDeleteDoc(doc(db, path));
    },

    async addDoc(path, data) {
      const ref = await fsAddDoc(collection(db, path), encode(data));
      return ref.id;
    },

    async listDocs(path, options = {}) {
      const snap = await getDocs(buildQuery(db, path, options));
      return snap.docs.map((item) => ({ id: item.id, data: item.data() }));
    },

    async count(path, options = {}) {
      const snap = await getCountFromServer(buildQuery(db, path, options));
      return snap.data().count;
    },

    subscribeDoc(path, callback) {
      return onSnapshot(doc(db, path), (snap) => {
        callback(snap.exists() ? { id: snap.id, data: snap.data() } : null);
      });
    },

    subscribeList(path, options, callback) {
      return onSnapshot(buildQuery(db, path, options), (snap) => {
        callback(snap.docs.map((item) => ({ id: item.id, data: item.data() })));
      });
    },

    async runTransaction(run) {
      return runTransaction(db, async (trx) => {
        const tx = {
          async get(path) {
            const snap = await trx.get(doc(db, path));
            return snap.exists() ? { id: snap.id, data: snap.data() } : null;
          },
          async query(path, options = {}) {
            const snap = await trx.get(buildQuery(db, path, options));
            return snap.docs.map((item) => ({ id: item.id, data: item.data() }));
          },
          set(path, data, options = {}) {
            trx.set(doc(db, path), encode(data), options.merge ? { merge: true } : undefined);
          },
          update(path, patch) {
            trx.update(doc(db, path), encode(patch));
          },
          delete(path) {
            trx.delete(doc(db, path));
          },
        };
        return run(tx);
      });
    },
  };

  const authApi = {
    mode: 'firebase',
    currentUser: auth.currentUser,
    subscribe(callback) {
      return onAuthStateChanged(auth, (user) =>
        callback(
          user
            ? {
                uid: user.uid,
                displayName: user.displayName || '',
                email: user.email || '',
                photoURL: user.photoURL || '',
              }
            : null
        )
      );
    },
    async signIn() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await signInWithPopup(auth, provider);
      } catch (error) {
        if (error?.code === 'auth/popup-blocked') {
          throw new Error('Il browser ha bloccato il popup di Google: consentilo e riprova.');
        }
        if (error?.code === 'auth/popup-closed-by-user' || error?.code === 'auth/cancelled-popup-request') {
          throw new Error('Accesso annullato.');
        }
        if (error?.code === 'auth/unauthorized-domain') {
          throw new Error(
            'Dominio non autorizzato: aggiungilo in Firebase → Authentication → Domini autorizzati.'
          );
        }
        throw error;
      }
    },
    async signOut() {
      await fbSignOut(auth);
    },
  };

  return { store, auth: authApi };
}
