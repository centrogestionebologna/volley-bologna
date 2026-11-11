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

function matchSnapshot(match = {}) {
  return {
    id: match.id || '',
    title: String(match.title || 'Match aperto'),
    sport: match.sport === 'beach' ? 'beach' : 'indoor',
    startsAt: match.startsAt || null,
    time: match.time || '',
    gym: match.gym || '',
    zone: match.zone || '',
    cost: Number(match.cost) || 0,
    level: match.level || 'intermedio',
    ageBand: match.ageBand || 'universitari',
    maxPlayers: Number(match.maxPlayers) || 0,
    confirmedCount: Number(match.confirmedCount) || 0,
    waitlistCount: Number(match.waitlistCount) || 0,
    status: match.status || 'open',
    organizerNickname: match.organizerNickname || '',
  };
}

/** Pubblica una proposta di match nella chat generale. */
export async function postMatchProposal({ organizer, matchId, match }) {
  if (!organizer?.uid || !matchId) throw new Error('Dati del match non validi.');
  return store.addDoc(generalChatPath, {
    authorId: organizer.uid,
    authorNickname: organizer.nickname || 'Organizzatore',
    text: `Proposta di match: ${String(match?.title || 'nuovo match').slice(0, 160)}`,
    createdAt: serverTimestamp(),
    editedAt: null,
    deleted: false,
    deletedAt: null,
    replyTo: null,
    type: 'match',
    matchId,
    match: matchSnapshot({ ...match, id: matchId }),
  });
}

/** Pubblica una proposta di match nella chat del gruppo. */
export async function postMatchProposalToGroup({ groupId, organizer, matchId, match }) {
  if (!groupId || !organizer?.uid || !matchId) throw new Error('Dati del match non validi.');
  return store.addDoc(groupChatPath(groupId), {
    authorId: organizer.uid,
    authorNickname: organizer.nickname || 'Organizzatore',
    text: `Proposta di match: ${String(match?.title || 'nuovo match').slice(0, 160)}`,
    createdAt: serverTimestamp(),
    editedAt: null,
    deleted: false,
    deletedAt: null,
    replyTo: null,
    type: 'match',
    matchId,
    match: matchSnapshot({ ...match, id: matchId }),
  });
}

/** Pubblica una ricerca giocatori senza esporre il nome del gruppo privato. */
export async function postPlayerRequestProposal({ organizer, requestId, request }) {
  if (!organizer?.uid || !requestId) throw new Error('Dati della ricerca non validi.');
  return store.addDoc(generalChatPath, {
    authorId: organizer.uid,
    authorNickname: 'Gruppo privato',
    text: 'Ricerca giocatori da gruppo privato',
    createdAt: serverTimestamp(),
    editedAt: null,
    deleted: false,
    deletedAt: null,
    replyTo: null,
    type: 'playerRequest',
    requestId,
    request: {
      matchSummary: request.matchSummary || {},
      neededRoles: Array.isArray(request.neededRoles) ? request.neededRoles : [],
      slotsNeeded: Number(request.slotsNeeded) || 1,
      note: request.note || '',
      status: request.status || 'open',
    },
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

const CLEAR_PAGE_SIZE = 200;
const CLEAR_MAX_PAGES = 100;

/** Elimina definitivamente tutti i messaggi di una chat (riservato agli admin). */
export async function clearChatMessages({ path }) {
  if (!path) throw new Error('Chat non valida.');
  let deleted = 0;
  for (let page = 0; page < CLEAR_MAX_PAGES; page += 1) {
    const rows = await store.listDocs(path, { limit: CLEAR_PAGE_SIZE });
    if (!rows.length) break;
    await Promise.all(rows.map((row) => store.deleteDoc(`${path}/${row.id}`)));
    deleted += rows.length;
    if (rows.length < CLEAR_PAGE_SIZE) break;
  }
  return deleted;
}
