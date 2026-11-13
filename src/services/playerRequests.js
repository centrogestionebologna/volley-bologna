import { store } from '../backend';
import { serverTimestamp } from '../store/base';
import { VOLLEY_ROLES } from '../config';
import { toDate } from '../lib/format';
import { postPlayerRequestProposal } from './chat';
import { queuePush } from './push';

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

const GUEST_HOURS_AFTER_MATCH = 6;
const GUEST_FALLBACK_MS = 24 * 3600000;
const GUEST_MAX_MS = 29 * 86400000;

const memberPath = (groupId, uid) => `groups/${groupId}/members/${uid}`;

/** L'accesso ospite dura fino a 6 ore dopo l'inizio del match (min. 1 ora, max 29 giorni). */
function guestUntilFor(match, now) {
  const start = toDate(match?.startsAt);
  const desired =
    start && start.getTime() > now
      ? start.getTime() + GUEST_HOURS_AFTER_MATCH * 3600000
      : now + GUEST_FALLBACK_MS;
  return new Date(Math.min(Math.max(desired, now + 3600000), now + GUEST_MAX_MS));
}

/**
 * Approva una candidatura e, se il match è di un gruppo privato, aggiunge il
 * giocatore alla chat del gruppo come ospite temporaneo (nome + "guest").
 * Descrizione del gruppo e codici invito restano riservati: l'ospite vede solo
 * la chat e la membership scade da sola a match concluso.
 */
export async function approveApplication({ requestId, applicantUid, reviewerUid }) {
  if (!requestId || !applicantUid) throw new Error('Candidatura non valida.');

  const result = await store.runTransaction(async (tx) => {
    // Tutte le letture prima delle scritture: vincolo delle transazioni Firestore.
    const application = await tx.get(applicationPath(requestId, applicantUid));
    if (!application) throw new Error('Candidatura non trovata.');
    const requestDoc = await tx.get(requestPath(requestId));
    const request = requestDoc?.data || null;
    const matchDoc = request?.matchId ? await tx.get(`matches/${request.matchId}`) : null;
    const groupDoc = request?.groupId ? await tx.get(`groups/${request.groupId}`) : null;
    const membership = request?.groupId
      ? await tx.get(memberPath(request.groupId, applicantUid))
      : null;

    if (application.data.status === 'approved') return { guest: null };

    tx.update(applicationPath(requestId, applicantUid), {
      status: 'approved',
      reviewedAt: serverTimestamp(),
      reviewedBy: reviewerUid || null,
      updatedAt: serverTimestamp(),
    });
    tx.update(requestPath(requestId), { updatedAt: serverTimestamp() });

    if (!request?.groupId || !request?.matchId || !groupDoc) return { guest: null };
    // Chi è già membro attivo resta membro: non lo declassiamo a ospite.
    if (membership?.data?.status === 'active') return { guest: null };

    const guestUntil = guestUntilFor(matchDoc?.data, Date.now());
    const nickname = application.data.nickname || membership?.data?.nickname || 'Giocatore';

    tx.set(memberPath(request.groupId, applicantUid), {
      uid: applicantUid,
      nickname,
      role: 'guest',
      status: 'active',
      inviteHash: null,
      guestRequestId: requestId,
      guestMatchId: request.matchId,
      guestUntil,
      // L'ospite vede la chat da questo momento: non i messaggi precedenti.
      joinedAt: serverTimestamp(),
    });

    // L'ospite conta come membro attivo (prima non lo era: era esterno o in attesa).
    tx.update(`groups/${request.groupId}`, {
      memberCount: Math.max(1, (groupDoc.data.memberCount || 1) + 1),
      pendingCount: Math.max(
        0,
        (groupDoc.data.pendingCount || 0) - (membership?.data?.status === 'pending' ? 1 : 0)
      ),
      updatedAt: serverTimestamp(),
    });

    return {
      guest: {
        nickname,
        groupId: request.groupId,
        groupName: groupDoc.data.name || 'Gruppo privato',
        guestUntil,
      },
    };
  });

  const guest = result?.guest || null;
  if (guest) {
    await queuePush({
      type: 'group',
      title: 'Candidatura approvata',
      body: `Sei nella chat di ${guest.groupName} come ospite: il nome compare con “guest”.`,
      url: `/gruppi/${guest.groupId}?focus=1`,
      tag: `ospite-${guest.groupId}`,
      audience: 'user',
      userId: applicantUid,
      actorId: reviewerUid || null,
    });
  }

  return guest;
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
