import { store } from '../backend';
import { serverTimestamp } from '../store/base';
import { LIMITS } from '../config';
import { findBannedWord } from './moderation';
import { toDate } from '../lib/format';

export const generalChatPath = 'chats/general/messages';
export const groupChatPath = (groupId) => `groups/${groupId}/messages`;

export function subscribeMessages(path, callback, limit = LIMITS.messagesPageSize) {
  return store.subscribeList(
    path,
    { orderBy: [['createdAt', 'desc']], limit },
    (rows) => {
      const messages = rows
        .filter((row) => row.data.createdAt)
        .sort((a, b) => (toDate(a.data.createdAt)?.getTime() || 0) - (toDate(b.data.createdAt)?.getTime() || 0))
        .map((row) => ({ id: row.id, ...row.data }));
      callback(messages);
    }
  );
}

export async function loadOlderMessages(path, beforeDate, limit = LIMITS.messagesPageSize) {
  const rows = await store.listDocs(path, {
    where: [['createdAt', '<', beforeDate]],
    orderBy: [['createdAt', 'desc']],
    limit,
  });
  return rows
    .filter((row) => row.data.createdAt)
    .sort((a, b) => (toDate(a.data.createdAt)?.getTime() || 0) - (toDate(b.data.createdAt)?.getTime() || 0))
    .map((row) => ({ id: row.id, ...row.data }));
}

function validateText(text, bannedWords) {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('Scrivi un messaggio.');
  if (clean.length > LIMITS.maxMessageLength) {
    throw new Error(`Il messaggio supera i ${LIMITS.maxMessageLength} caratteri.`);
  }
  const banned = findBannedWord(clean, bannedWords);
  if (banned) {
    throw new Error(`Il messaggio contiene una parola non consentita ("${banned}").`);
  }
  return clean;
}

export async function sendMessage({ path, author, text, replyTo = null, bannedWords = [] }) {
  const clean = validateText(text, bannedWords);
  return store.addDoc(path, {
    authorId: author.uid,
    authorNickname: author.nickname,
    text: clean,
    createdAt: serverTimestamp(),
    editedAt: null,
    deleted: false,
    deletedAt: null,
    replyTo: replyTo
      ? {
          id: replyTo.id,
          nickname: replyTo.authorNickname,
          text: replyTo.deleted ? '' : String(replyTo.text || '').slice(0, 240),
        }
      : null,
  });
}

export async function editMessage({ path, messageId, text, bannedWords = [] }) {
  const clean = validateText(text, bannedWords);
  await store.updateDoc(`${path}/${messageId}`, {
    text: clean,
    editedAt: serverTimestamp(),
  });
}

export async function deleteMessage({ path, messageId, deletedBy }) {
  await store.updateDoc(`${path}/${messageId}`, {
    text: '',
    deleted: true,
    deletedAt: serverTimestamp(),
    deletedBy,
  });
}
