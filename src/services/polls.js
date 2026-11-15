import { store } from '../backend';
import { serverTimestamp } from '../store/base';
import { postGroupSystemMessage, postPollMessage } from './chat';

const pollsPath = (groupId) => `groups/${groupId}/polls`;
export const pollPath = (groupId, pollId) => `groups/${groupId}/polls/${pollId}`;
export const pollVotePath = (groupId, pollId, uid) =>
  `groups/${groupId}/polls/${pollId}/votes/${uid}`;

export function subscribePolls(groupId, callback) {
  if (!groupId) return () => {};
  return store.subscribeList(
    pollsPath(groupId),
    { orderBy: [['createdAt', 'desc']], limit: 20 },
    callback
  );
}

export function subscribePoll(groupId, pollId, callback) {
  if (!groupId || !pollId) return () => {};
  return store.subscribeDoc(pollPath(groupId, pollId), callback);
}

export function subscribePollVotes(groupId, pollId, callback) {
  if (!groupId || !pollId) return () => {};
  return store.subscribeList(
    `${pollPath(groupId, pollId)}/votes`,
    { limit: 100 },
    callback
  );
}

export async function createPoll({ groupId, user, question, options = [] }) {
  if (!groupId || !user?.uid) throw new Error('Sessione non valida.');
  const cleanQuestion = String(question || '').trim();
  if (cleanQuestion.length < 3) throw new Error('Scrivi la domanda del sondaggio.');
  const cleanOptions = [...new Set(options.map((item) => String(item || '').trim()))]
    .filter(Boolean)
    .slice(0, 8);
  if (cleanOptions.length < 2) throw new Error('Servono almeno due opzioni diverse.');

  const pollId = await store.addDoc(pollsPath(groupId), {
    question: cleanQuestion.slice(0, 200),
    options: cleanOptions.map((item) => item.slice(0, 80)),
    createdBy: user.uid,
    createdByName: user.nickname || 'Membro',
    status: 'open',
    closedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Il sondaggio compare subito nella chat del gruppo, con la scheda per votare.
  let chatPosted = false;
  try {
    await postPollMessage({
      groupId,
      actorUid: user.uid,
      pollId,
      question: cleanQuestion,
      nickname: user.nickname,
    });
    chatPosted = true;
  } catch (error) {
    console.warn('Sondaggio non pubblicato in chat', error?.message);
  }

  return { id: pollId, chatPosted };
}

export async function votePoll({ groupId, pollId, uid, optionIndex }) {
  if (!groupId || !pollId || !uid) throw new Error('Sondaggio non valido.');
  const index = Number(optionIndex);
  if (!Number.isInteger(index) || index < 0) throw new Error('Opzione non valida.');
  await store.setDoc(pollVotePath(groupId, pollId, uid), {
    uid,
    optionIndex: index,
    createdAt: serverTimestamp(),
  });
}

export async function closePoll({ groupId, pollId, uid = null, question = '' }) {
  await store.updateDoc(pollPath(groupId, pollId), {
    status: 'closed',
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  if (uid) {
    await postGroupSystemMessage({
      groupId,
      actorUid: uid,
      kind: 'poll-closed',
      text: question
        ? `Il sondaggio «${String(question).slice(0, 120)}» è stato chiuso.`
        : 'Un sondaggio è stato chiuso.',
    });
  }
}

export async function deletePoll({ groupId, pollId }) {
  await store.deleteDoc(pollPath(groupId, pollId));
}

/** Conteggi per opzione a partire dai voti (un documento per votante). */
export function tallyVotes(votes = [], optionCount = 0) {
  const counts = Array.from({ length: optionCount }, () => 0);
  for (const vote of votes) {
    const index = Number(vote.optionIndex);
    if (Number.isInteger(index) && index >= 0 && index < counts.length) counts[index] += 1;
  }
  return counts;
}
