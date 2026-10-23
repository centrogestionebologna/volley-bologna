import { store } from '../backend';
import { serverTimestamp } from '../store/base';
import { splitName, suggestNickname } from '../lib/format';
import { LIMITS } from '../config';

const privatePath = (uid) => `users/${uid}`;
const publicPath = (uid) => `publicProfiles/${uid}`;

/** Crea (se serve) i documenti profilo al primo accesso. */
export async function ensureProfile(fbUser) {
  const existing = await store.getDoc(privatePath(fbUser.uid));
  if (existing) {
    const publicDoc = await store.getDoc(publicPath(fbUser.uid));
    if (!publicDoc) {
      await store.setDoc(publicPath(fbUser.uid), {
        uid: fbUser.uid,
        nickname: existing.data.nickname,
        photoURL: fbUser.photoURL || '',
        bio: '',
        verified: Boolean(existing.data.verified),
        createdAt: serverTimestamp(),
      });
    }
    if (existing.data.email !== fbUser.email) {
      await store.updateDoc(privatePath(fbUser.uid), { email: fbUser.email || '' });
    }
    return existing.data;
  }

  const { realName, surname } = splitName(fbUser.displayName || '');
  const nickname = suggestNickname(fbUser.displayName, fbUser.email).slice(0, LIMITS.maxNicknameLength);
  const createdAt = serverTimestamp();
  const privateProfile = {
    uid: fbUser.uid,
    email: fbUser.email || '',
    realName: realName || fbUser.displayName || '',
    surname,
    phone: '',
    nickname,
    verified: false,
    verificationStatus: 'none',
    verificationNote: '',
    banned: false,
    silencedUntil: null,
    createdAt,
    updatedAt: createdAt,
  };
  await store.setDoc(privatePath(fbUser.uid), privateProfile);
  await store.setDoc(publicPath(fbUser.uid), {
    uid: fbUser.uid,
    nickname,
    photoURL: fbUser.photoURL || '',
    bio: '',
    verified: false,
    createdAt,
  });
  return { ...privateProfile, createdAt: Date.now(), updatedAt: Date.now() };
}

export function subscribePrivateProfile(uid, callback) {
  return store.subscribeDoc(privatePath(uid), callback);
}

export function subscribePublicProfile(uid, callback) {
  return store.subscribeDoc(publicPath(uid), callback);
}

export async function getPublicProfile(uid) {
  return store.getDoc(publicPath(uid));
}

export async function saveNickname(uid, nickname) {
  const clean = nickname.trim().slice(0, LIMITS.maxNicknameLength);
  if (clean.length < 2) throw new Error('Il nickname deve avere almeno 2 caratteri.');
  await store.updateDoc(privatePath(uid), { nickname: clean, updatedAt: serverTimestamp() });
  await store.updateDoc(publicPath(uid), { nickname: clean });
  return clean;
}

export async function savePrivateData(uid, { realName, surname, phone }) {
  const payload = {};
  if (typeof realName === 'string') payload.realName = realName.trim();
  if (typeof surname === 'string') payload.surname = surname.trim();
  if (typeof phone === 'string') payload.phone = phone.trim();
  payload.updatedAt = serverTimestamp();
  await store.updateDoc(privatePath(uid), payload);
}

export async function savePublicData(uid, { bio, photoURL }) {
  const payload = {};
  if (typeof bio === 'string') payload.bio = bio.trim().slice(0, 240);
  if (typeof photoURL === 'string') payload.photoURL = photoURL.trim();
  await store.updateDoc(publicPath(uid), payload);
}

/** L'utente chiede la verifica manuale dei propri dati. */
export async function submitVerification(uid) {
  await store.updateDoc(privatePath(uid), {
    verificationStatus: 'submitted',
    verificationNote: '',
    updatedAt: serverTimestamp(),
  });
}

export async function isAdminUser(uid) {
  if (!uid) return false;
  const doc = await store.getDoc(`admins/${uid}`);
  return Boolean(doc);
}

export function subscribeAdmin(uid, callback) {
  return store.subscribeDoc(`admins/${uid}`, (doc) => callback(Boolean(doc)));
}

export async function listPublicProfiles({ search = '', limit = 30 } = {}) {
  const rows = await store.listDocs('publicProfiles', {
    orderBy: [['nickname', 'asc']],
    limit: 200,
  });
  const q = search.trim().toLowerCase();
  if (!q) return rows.slice(0, limit);
  return rows.filter((row) => row.data.nickname?.toLowerCase().includes(q)).slice(0, limit);
}
