import { store } from '../backend';
import { serverTimestamp } from '../store/base';
import { VOLLEY_ROLES } from '../config';
import { postPlayerRequestProposal } from './chat';

const requestPath = (requestId) => `playerRequests/${requestId}`;
const applicationPath = (requestId, uid) => `${requestPath(requestId)}/applications/${uid}`;
const allowedRoles = new Set(VOLLEY_ROLES.map((role) => role.value));

export function subscribePlayerRequest(requestId, callback) {
  return store.subscribeDoc(requestPath(requestId), callback);
}

export function subscribeApplications(requestId, callback) {
  return store.subscribeList(
    `${requestPath(requestId)}/applications`,
    { orderBy: [['createdAt', 'asc']], limit: 100 },
    callback
  );
}

export function subscribeMyApplication(requestId, uid, callback) {
  if (!uid) return () => {};
  return store.subscribeDoc(applicationPath(requestId, uid), callback);
}

/**
 * Crea una ricerca giocatori per un match di un gruppo privato.
 * Il messaggio in #generale contiene solo i dati del match e i ruoli mancanti:
 * nome del gruppo, organizzatore e link al match restano fuori dalla chat.
 */
export async function createPlayerRequest({
  group,
  match,
  organizer,
  neededRoles = [],
  slotsNeeded = 1,
  note = '',
}) {
  if (!group?.id || group.visibility !== 'private') {
    throw new Error('La ricerca giocatori è disponibile solo per i gruppi privati.');
  }
  if (group.ownerId !== organizer?.uid) {
    throw new Error('Solo il fondatore del gruppo può pubblicare una ricerca.');
  }
  if (!match?.id) throw new Error('Scegli il match per cui cerchi giocatori.');
  if (match.organizerId && match.organizerId !== organizer.uid) {
    throw new Error('Puoi cercare giocatori solo per i tuoi match.');
  }

  const roles = [...new Set(neededRoles.filter((role) => allowedRoles.has(role)))];
  const slots = Math.min(8, Math.max(1, Number(slotsNeeded) || 1));
  const cleanNote = String(note || '').trim().slice(0, 400);
  const matchSummary = {
    startsAt: match.startsAt || null,
    time: match.time || '',
    gym: match.gym || '',
    zone: match.zone || '',
    level: match.level || 'intermedio',
    ageBand: match.ageBand || 'universitari',
    sport: match.sport || 'indoor',
    cost: Number(match.cost) || 0,
    maxPlayers: Number(match.maxPlayers) || 0,
    confirmedCount: Number(match.confirmedCount) || 0,
    neededRoles: roles,
    slotsNeeded: slots,
    note: cleanNote,
  };

  const requestId = await store.addDoc('playerRequests', {
    groupId: group.id,
    organizerId: organizer.uid,
    organizerNickname: organizer.nickname || 'Organizzatore',
    matchId: match.id,
    matchSummary,
    neededRoles: roles,
    slotsNeeded: slots,
    note: cleanNote,
    status: 'open',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    chatMessageId: null,
  });

  let chatPublished = false;
  try {
    const messageId = await postPlayerRequestProposal({
      organizer,
      requestId,
      request: { matchSummary, neededRoles: roles, slotsNeeded: slots, note: cleanNote, status: 'open' },
    });
    await store.updateDoc(requestPath(requestId), { chatMessageId: messageId });
    chatPublished = true;
  } catch (error) {
    console.warn('Ricerca creata ma non pubblicata in chat generale', error?.message);
  }

  return { id: requestId, chatPublished };
}

export async function applyToPlayerRequest({ requestId, user, role = '', note = '' }) {
  if (!requestId || !user?.uid) throw new Error('Sessione non valida.');
  const cleanRole = allowedRoles.has(role) ? role : '';
  const cleanNote = String(note || '').trim().slice(0, 300);
  await store.setDoc(applicationPath(requestId, user.uid), {
    uid: user.uid,
    nickname: user.nickname || 'Giocatore',
    role: cleanRole,
    note: cleanNote,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    reviewedAt: null,
    reviewedBy: null,
  });
}

export async function approveApplication({ requestId, applicantUid, reviewerUid }) {
  if (!requestId || !applicantUid) throw new Error('Candidatura non valida.');
  return store.runTransaction(async (tx) => {
    const application = await tx.get(applicationPath(requestId, applicantUid));
    if (!application) throw new Error('Candidatura non trovata.');
    if (application.data.status === 'approved') return;
    tx.update(applicationPath(requestId, applicantUid), {
      status: 'approved',
      reviewedAt: serverTimestamp(),
      reviewedBy: reviewerUid || null,
      updatedAt: serverTimestamp(),
    });
    tx.update(requestPath(requestId), { updatedAt: serverTimestamp() });
  });
}

export async function rejectApplication({ requestId, applicantUid, reviewerUid }) {
  if (!requestId || !applicantUid) throw new Error('Candidatura non valida.');
  return store.runTransaction(async (tx) => {
    const application = await tx.get(applicationPath(requestId, applicantUid));
    if (!application) throw new Error('Candidatura non trovata.');
    if (application.data.status === 'rejected') return;
    tx.update(applicationPath(requestId, applicantUid), {
      status: 'rejected',
      reviewedAt: serverTimestamp(),
      reviewedBy: reviewerUid || null,
      updatedAt: serverTimestamp(),
    });
    tx.update(requestPath(requestId), { updatedAt: serverTimestamp() });
  });
}

export async function closePlayerRequest({ requestId }) {
  await store.updateDoc(requestPath(requestId), {
    status: 'closed',
    updatedAt: serverTimestamp(),
  });
}
