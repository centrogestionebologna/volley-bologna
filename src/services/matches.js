import { store } from '../backend';
import { serverTimestamp } from '../store/base';
import { LIMITS } from '../config';
import { toDate, dateKey, timeKey } from '../lib/format';

const OFFER_MS = LIMITS.offerMinutes * 60 * 1000;
const HOUR_MS = 3600000;

export const regPath = (matchId, uid) => `matches/${matchId}/registrations/${uid}`;

export function listUpcomingMatches({ limit = 60 } = {}) {
  return store.listDocs('matches', {
    where: [['status', '==', 'open']],
    orderBy: [['startsAt', 'asc']],
    limit,
  });
}

export function subscribeMatch(matchId, callback) {
  return store.subscribeDoc(`matches/${matchId}`, callback);
}

export function subscribeRegistrations(matchId, callback) {
  return store.subscribeList(
    `matches/${matchId}/registrations`,
    { orderBy: [['seq', 'asc']], limit: 200 },
    callback
  );
}

export function subscribeMyOffers(uid, callback) {
  if (!uid) return () => {};
  return store.subscribeList(
    'matches',
    { where: [['pendingOfferUid', '==', uid]], limit: 5 },
    callback
  );
}

export async function pickNextWaitlist(tx, matchId) {
  const rows = await tx.query(`matches/${matchId}/registrations`, {
    where: [['status', '==', 'waitlist']],
  });
  return rows.sort((a, b) => (a.data.seq || 0) - (b.data.seq || 0))[0] || null;
}

/** Iscrizione atomica: contatori e timestamp calcolati dal server. */
export async function signUpForMatch({ matchId, user, nickname }) {
  return store.runTransaction(async (tx) => {
    const matchDoc = await tx.get(`matches/${matchId}`);
    if (!matchDoc) throw new Error('Match non trovato.');
    const match = matchDoc.data;
    if (match.status !== 'open') throw new Error('Le iscrizioni sono chiuse.');
    const start = toDate(match.startsAt);
    if (start && start.getTime() < Date.now()) throw new Error('Il match è già iniziato.');

    const existing = await tx.get(regPath(matchId, user.uid));
    if (existing) throw new Error('Sei già iscritto a questo match.');

    const hasOffer = Boolean(match.pendingOffer);
    const freeSeats = (match.confirmedCount || 0) < match.maxPlayers;
    const status = !hasOffer && freeSeats ? 'confirmed' : 'waitlist';
    const seq = (match.registrationSeq || 0) + 1;

    tx.set(regPath(matchId, user.uid), {
      uid: user.uid,
      nickname,
      status,
      seq,
      createdAt: serverTimestamp(),
      confirmedAt: status === 'confirmed' ? serverTimestamp() : null,
      offerExpiresAt: null,
    });

    tx.update(`matches/${matchId}`, {
      registrationSeq: seq,
      confirmedCount: (match.confirmedCount || 0) + (status === 'confirmed' ? 1 : 0),
      waitlistCount: (match.waitlistCount || 0) + (status === 'waitlist' ? 1 : 0),
      updatedAt: serverTimestamp(),
    });

    return status;
  });
}

async function leaveMatch(matchId, uid, { skipDeadline = false } = {}) {
  return store.runTransaction(async (tx) => {
    const matchDoc = await tx.get(`matches/${matchId}`);
    const regDoc = await tx.get(regPath(matchId, uid));
    if (!matchDoc) throw new Error('Match non trovato.');
    if (!regDoc) throw new Error('Iscrizione non trovata.');
    const match = matchDoc.data;
    const status = regDoc.data.status;

    if (!skipDeadline) {
      const deadline = toDate(match.deadlineAt);
      if (deadline && deadline.getTime() < Date.now()) {
        throw new Error('Il termine per disiscriversi è passato: contatta l’organizzatore.');
      }
    }

    const shouldPromote =
      status === 'offered' || (status === 'confirmed' && !match.pendingOffer);
    const next = shouldPromote ? await pickNextWaitlist(tx, matchId) : null;

    let confirmedCount = match.confirmedCount || 0;
    let waitlistCount = match.waitlistCount || 0;
    if (status === 'confirmed') confirmedCount = Math.max(0, confirmedCount - 1);
    else waitlistCount = Math.max(0, waitlistCount - 1);

    tx.delete(regPath(matchId, uid));

    const patch = {
      confirmedCount,
      waitlistCount,
      updatedAt: serverTimestamp(),
    };

    if (status === 'offered') {
      patch.pendingOffer = null;
      patch.pendingOfferUid = null;
    }

    if (next) {
      const expiresAt = new Date(Date.now() + OFFER_MS);
      tx.update(regPath(matchId, next.id), {
        status: 'offered',
        offerExpiresAt: expiresAt,
      });
      patch.pendingOffer = {
        uid: next.data.uid,
        nickname: next.data.nickname,
        seq: next.data.seq,
        expiresAt,
      };
      patch.pendingOfferUid = next.data.uid;
    }

    tx.update(`matches/${matchId}`, patch);
    return { status, promoted: next?.data?.nickname || null };
  });
}

/** Usato dalla manutenzione: se l'offerta è scaduta la rimuove e passa alla riserva successiva. */
export async function expirePendingOffer(matchId) {
  return store.runTransaction(async (tx) => {
    const matchDoc = await tx.get(`matches/${matchId}`);
    if (!matchDoc) return false;
    const match = matchDoc.data;
    const offer = match.pendingOffer;
    if (!offer) return false;
    const expiresAt = toDate(offer.expiresAt);
    if (!expiresAt || expiresAt.getTime() > Date.now()) return false;

    const expiredReg = await tx.get(regPath(matchId, offer.uid));
    const next = await pickNextWaitlist(tx, matchId);

    const patch = {
      pendingOffer: null,
      pendingOfferUid: null,
      waitlistCount: Math.max(0, (match.waitlistCount || 0) - 1),
      updatedAt: serverTimestamp(),
    };

    if (expiredReg) tx.delete(regPath(matchId, offer.uid));

    if (next && next.id !== offer.uid) {
      const newExpiry = new Date(Date.now() + OFFER_MS);
      tx.update(regPath(matchId, next.id), {
        status: 'offered',
        offerExpiresAt: newExpiry,
      });
      patch.pendingOffer = {
        uid: next.data.uid,
        nickname: next.data.nickname,
        seq: next.data.seq,
        expiresAt: newExpiry,
      };
      patch.pendingOfferUid = next.data.uid;
    }

    tx.update(`matches/${matchId}`, patch);
    return true;
  });
}

export async function cancelSignup({ matchId, uid }) {
  return leaveMatch(matchId, uid, { skipDeadline: false });
}

/** Rimozione da parte dell'organizzatore (o admin): nessun limite di deadline. */
export async function removeParticipant({ matchId, uid }) {
  return leaveMatch(matchId, uid, { skipDeadline: true });
}

export async function confirmSeat({ matchId, uid }) {
  return store.runTransaction(async (tx) => {
    const matchDoc = await tx.get(`matches/${matchId}`);
    const regDoc = await tx.get(regPath(matchId, uid));
    if (!matchDoc || !regDoc) throw new Error('Posto riservato non trovato.');
    const match = matchDoc.data;
    if (!match.pendingOffer || match.pendingOffer.uid !== uid) {
      throw new Error('Non c’è nessun posto riservato per te su questo match.');
    }
    const expiresAt = toDate(match.pendingOffer.expiresAt);
    if (expiresAt && expiresAt.getTime() < Date.now() - 60000) {
      throw new Error('Tempo scaduto: il posto è stato riassegnato.');
    }
    tx.update(regPath(matchId, uid), {
      status: 'confirmed',
      confirmedAt: serverTimestamp(),
      offerExpiresAt: null,
    });
    tx.update(`matches/${matchId}`, {
      confirmedCount: (match.confirmedCount || 0) + 1,
      waitlistCount: Math.max(0, (match.waitlistCount || 0) - 1),
      pendingOffer: null,
      pendingOfferUid: null,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function declineSeat({ matchId, uid }) {
  return store.runTransaction(async (tx) => {
    const matchDoc = await tx.get(`matches/${matchId}`);
    const regDoc = await tx.get(regPath(matchId, uid));
    if (!matchDoc || !regDoc) throw new Error('Posto riservato non trovato.');
    const match = matchDoc.data;
    if (!match.pendingOffer || match.pendingOffer.uid !== uid) {
      throw new Error('Non c’è nessun posto riservato per te su questo match.');
    }
    const next = await pickNextWaitlist(tx, matchId);
    const waitlistCount = Math.max(0, (match.waitlistCount || 0) - 1);

    tx.delete(regPath(matchId, uid));
    const patch = {
      waitlistCount,
      pendingOffer: null,
      pendingOfferUid: null,
      updatedAt: serverTimestamp(),
    };
    if (next && next.id !== uid) {
      const expiresAt = new Date(Date.now() + OFFER_MS);
      tx.update(regPath(matchId, next.id), { status: 'offered', offerExpiresAt: expiresAt });
      patch.pendingOffer = {
        uid: next.data.uid,
        nickname: next.data.nickname,
        seq: next.data.seq,
        expiresAt,
      };
      patch.pendingOfferUid = next.data.uid;
    }
    tx.update(`matches/${matchId}`, patch);
  });
}

function normalizeMatchInput(input) {
  const startsAt = input.startsAt instanceof Date ? input.startsAt : new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) throw new Error('Data e ora non valide.');
  if (startsAt.getTime() < Date.now()) throw new Error('La data del match è nel passato.');
  if (!input.gym?.trim()) throw new Error('Indica la palestra o la zona.');
  const maxPlayers = Number(input.maxPlayers);
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > LIMITS.maxPlayers) {
    throw new Error(`Il numero di giocatori deve essere tra 2 e ${LIMITS.maxPlayers}.`);
  }
  const cost = Number(input.cost || 0);
  if (Number.isNaN(cost) || cost < 0) throw new Error('Il costo non è valido.');
  const deadlineHours = Number(input.deadlineHours ?? 6);
  if (Number.isNaN(deadlineHours) || deadlineHours < 0 || deadlineHours > 168) {
    throw new Error('La deadline deve essere tra 0 e 168 ore prima.');
  }
  return {
    startsAt,
    date: dateKey(startsAt),
    time: timeKey(startsAt),
    deadlineHours,
    deadlineAt: new Date(startsAt.getTime() - deadlineHours * HOUR_MS),
    gym: input.gym.trim(),
    zone: input.zone?.trim() || '',
    cost,
    level: input.level || 'intermedio',
    maxPlayers,
    ageBand: input.ageBand || 'universitari',
    description: input.description?.trim().slice(0, 800) || '',
    title: input.title?.trim() || `Volley a ${input.gym.trim()}`,
    sport: input.sport === 'beach' ? 'beach' : 'indoor',
  };
}

export async function createMatch(input, organizer, { recurring = false } = {}) {
  const data = normalizeMatchInput(input);
  const matchId = await store.addDoc('matches', {
    ...data,
    organizerId: organizer.uid,
    organizerNickname: organizer.nickname,
    confirmedCount: 0,
    waitlistCount: 0,
    registrationSeq: 0,
    pendingOffer: null,
    pendingOfferUid: null,
    status: 'open',
    recurringId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (recurring) {
    await store.setDoc(`recurringMatches/${`rec-${matchId}`}`, {
      organizerId: organizer.uid,
      organizerNickname: organizer.nickname,
      title: data.title,
      sport: data.sport,
      weekday: data.startsAt.getDay(),
      time: data.time,
      gym: data.gym,
      zone: data.zone,
      cost: data.cost,
      level: data.level,
      maxPlayers: data.maxPlayers,
      ageBand: data.ageBand,
      deadlineHours: data.deadlineHours,
      description: data.description,
      sourceMatchId: matchId,
      active: true,
      lastPublishedDate: null,
      createdAt: serverTimestamp(),
    });
    await store.updateDoc(`matches/${matchId}`, { recurringId: `rec-${matchId}` });
  }

  return matchId;
}

export async function updateMatch(matchId, input) {
  const data = normalizeMatchInput(input);
  await store.updateDoc(`matches/${matchId}`, { ...data, updatedAt: serverTimestamp() });
}

export async function setMatchStatus(matchId, status) {
  await store.updateDoc(`matches/${matchId}`, { status, updatedAt: serverTimestamp() });
}

export async function deleteMatch(matchId) {
  await store.deleteDoc(`matches/${matchId}`);
}

export function subscribeRecurringRules(organizerId, callback) {
  return store.subscribeList(
    'recurringMatches',
    { where: [['organizerId', '==', organizerId]], limit: 50 },
    callback
  );
}

export async function toggleRecurringRule(ruleId, active) {
  await store.updateDoc(`recurringMatches/${ruleId}`, { active, updatedAt: serverTimestamp() });
}

export async function deleteRecurringRule(ruleId) {
  await store.deleteDoc(`recurringMatches/${ruleId}`);
}

export async function listMyRegistrations(uid) {
  const matches = await listUpcomingMatches({ limit: 30 });
  const rows = await Promise.all(
    matches.map(async (match) => {
      const reg = await store.getDoc(regPath(match.id, uid));
      return reg ? { match: { id: match.id, ...match.data }, reg: reg.data } : null;
    })
  );
  return rows.filter(Boolean);
}
