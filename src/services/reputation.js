import { store } from '../backend';
import { serverTimestamp } from '../store/base';

export function subscribeTrusted(organizerId, callback) {
  if (!organizerId) return () => {};
  return store.subscribeList(
    `organizers/${organizerId}/trusted`,
    { orderBy: [['createdAt', 'desc']], limit: 200 },
    callback
  );
}

export function subscribeRatings(organizerId, callback) {
  if (!organizerId) return () => {};
  return store.subscribeList(
    `organizers/${organizerId}/ratings`,
    { orderBy: [['createdAt', 'desc']], limit: 200 },
    callback
  );
}

export async function setTrusted({ organizerId, userId, nickname, note = '', trusted }) {
  const path = `organizers/${organizerId}/trusted/${userId}`;
  if (!trusted) {
    await store.deleteDoc(path);
    return;
  }
  await store.setDoc(path, {
    userId,
    nickname,
    note: note.slice(0, 300),
    createdAt: serverTimestamp(),
  });
}

export async function rateUser({ organizerId, userId, nickname, score, note = '' }) {
  const value = Number(score);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error('La valutazione deve essere tra 1 e 5.');
  }
  await store.setDoc(`organizers/${organizerId}/ratings/${userId}`, {
    userId,
    nickname,
    score: value,
    note: note.slice(0, 300),
    createdAt: serverTimestamp(),
  });
}
