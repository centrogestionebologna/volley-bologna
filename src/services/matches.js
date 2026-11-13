import { store } from '../backend';
import { serverTimestamp } from '../store/base';
import { LIMITS } from '../config';
import { toDate, dateKey, timeKey } from '../lib/format';
import { postMatchProposal, postMatchProposalToGroup } from './chat';
import { queuePush } from './push';

const OFFER_MS = LIMITS.offerMinutes * 60 * 1000;
const HOUR_MS = 3600000;

const logPath = (matchId, seq) => `matches/${matchId}/log/${String(seq).padStart(6, '0')}`;

/**
 * Registro della lista. Ogni voce prende un progressivo (logSeq) assegnato
 * nella stessa transazione che modifica il match: l'ordine è quindi esatto
 * anche con decine di iscrizioni nello stesso secondo (il timestamp da solo
 * può pareggiare, il progressivo no).
 */
function createLog(tx, matchId, match) {
  let seq = Number(match.logSeq) || 0;
  return {
    add(type, text, extra = {}) {
      seq += 1;
      tx.set(logPath(matchId, seq), {
        seq,
        at: serverTimestamp(),
        type,
        text: String(text || '').slice(0, 160),
        uid: extra.uid || null,
        nickname: extra.nickname || '',
        actorId: extra.actorId || null,
      });
      return seq;
    },
    get lastSeq() {
      return seq;
    },
  };
}

export const regPath = (matchId, uid) => `matches/${matchId}/registrations/${uid}`;
export const replacementPath = (matchId, uid) =>
  `matches/${matchId}/replacementRequests/${uid}`;

export function listUpcomingMatches({ limit = 60, includeGroupPrivate = false } = {}) {
  return store
    .listDocs('matches', {
      where: [['status', '==', 'open']],
      orderBy: [['startsAt', 'asc']],
      limit,
    })
    .then((rows) =>
      includeGroupPrivate
        ? rows
        : rows.filter((row) => row.data.visibility !== 'group-private')
    );
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

export function subscribeMatchLog(matchId, callback) {
  return store.subscribeList(
    `matches/${matchId}/log`,
    { orderBy: [['seq', 'asc']], limit: 200 },
    callback
  );
}

export function subscribeReplacementRequests(matchId, callback) {
  return store.subscribeList(
    `matches/${matchId}/replacementRequests`,
    { orderBy: [['createdAt', 'asc']], limit: 50 },
    callback
  );
}

export function subscribeMyReplacementRequest(matchId, uid, callback) {
  if (!uid) return () => {};
  return store.subscribeDoc(replacementPath(matchId, uid), callback);
}

/** Sceglie la prima riserva libera in ordine cronologico, saltando l'escluso. */
function firstWaitlist(waitlist, excludeUid = null) {
  return (
    waitlist
      .filter((row) => row.data.status === 'waitlist' && row.id !== excludeUid)
      .sort((a, b) => (a.data.seq || 0) - (b.data.seq || 0))[0] || null
  );
}

/**
 * Chi non può più venire dopo la deadline chiede la sostituzione. Resta
 * iscritto (quindi il fondatore vede ancora i suoi dati) finché qualcuno non
 * accetta: il posto viene subito offerto alla prima riserva, in ordine.
 */
export async function requestReplacement({ matchId, match, user, note = '' }) {
  if (!matchId || !user?.uid) throw new Error('Sessione non valida.');
  const cleanNote = String(note || '').trim().slice(0, 300);
  const nickname = user.nickname || 'Giocatore';

  const result = await store.runTransaction(async (tx) => {
    const matchDoc = await tx.get(`matches/${matchId}`);
    if (!matchDoc) throw new Error('Match non trovato.');
    const fresh = matchDoc.data;
    const deadline = toDate(fresh.deadlineAt);
    if (deadline && deadline.getTime() > Date.now()) {
      throw new Error('La deadline non è ancora passata: puoi disiscriverti normalmente.');
    }
    const reg = await tx.get(regPath(matchId, user.uid));
    if (!reg) throw new Error('Non risulti iscritto a questo match.');
    const existing = await tx.get(replacementPath(matchId, user.uid));
    const waitlist = fresh.pendingOffer
      ? []
      : await tx.query(`matches/${matchId}/registrations`, {
          where: [['status', '==', 'waitlist']],
        });
    const next = firstWaitlist(waitlist, user.uid);

    tx.set(replacementPath(matchId, user.uid), {
      uid: user.uid,
      nickname,
      matchId,
      note: cleanNote,
      status: 'open',
      createdAt: existing?.data?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
      handledAt: null,
      handledBy: null,
      filledAt: null,
      filledBy: null,
    });

    const log = createLog(tx, matchId, fresh);
    log.add('replacement_request', `${nickname} non può venire: cerca un sostituto`, {
      uid: user.uid,
      nickname,
      actorId: user.uid,
    });

    const patch = { updatedAt: serverTimestamp() };
    if (next) {
      const expiresAt = new Date(Date.now() + OFFER_MS);
      tx.update(regPath(matchId, next.id), {
        status: 'offered',
        offerExpiresAt: expiresAt,
      });
      patch.pendingOffer = {
        uid: next.id,
        nickname: next.data.nickname || '',
        seq: next.data.seq || 0,
        expiresAt,
        replacementFor: user.uid,
        replacementRequestId: user.uid,
      };
      patch.pendingOfferUid = next.id;
      log.add('offer', `Posto offerto in sostituzione a ${next.data.nickname || 'una riserva'}`, {
        uid: next.id,
        nickname: next.data.nickname || '',
        actorId: user.uid,
      });
    }
    tx.update(`matches/${matchId}`, { ...patch, logSeq: log.lastSeq });

    return { offeredUid: next?.id || null, offeredNickname: next?.data?.nickname || null };
  });

  if (match?.organizerId) {
    await queuePush({
      type: 'match',
      title: 'Richiesta di sostituzione',
      body: `${nickname} non può più venire a ${match.title || 'un match'}.`,
      url: `/match/${matchId}`,
      tag: `sostituzione-${matchId}`,
      audience: 'user',
      userId: match.organizerId,
      matchId,
      actorId: user.uid,
    });
  }

  if (result?.offeredUid) {
    await queuePush({
      type: 'offer',
      title: 'Posto disponibile',
      body: `Sei il primo in riserva per ${match?.title || 'un match'}: hai 30 minuti per accettare la sostituzione.`,
      url: `/match/${matchId}`,
      tag: `offerta-${matchId}`,
      audience: 'user',
      userId: result.offeredUid,
      matchId,
    });
  }

  return result;
}

/** L'organizzatore riprova a offrire il posto alla prima riserva. */
export async function offerReplacementSeat({ matchId, requesterUid, actor }) {
  return store.runTransaction(async (tx) => {
    const matchDoc = await tx.get(`matches/${matchId}`);
    if (!matchDoc) throw new Error('Match non trovato.');
    const match = matchDoc.data;
    if (match.pendingOffer) throw new Error('C’è già un’offerta in corso.');
    const requestDoc = await tx.get(replacementPath(matchId, requesterUid));
    if (!requestDoc || requestDoc.data.status !== 'open') {
      throw new Error('Questa richiesta non è più aperta.');
    }
    const waitlist = await tx.query(`matches/${matchId}/registrations`, {
      where: [['status', '==', 'waitlist']],
    });
    const next = firstWaitlist(waitlist, requesterUid);
    if (!next) throw new Error('Nessuna riserva disponibile: puoi rimuovere l’iscritto.');

    const expiresAt = new Date(Date.now() + OFFER_MS);
    tx.update(regPath(matchId, next.id), { status: 'offered', offerExpiresAt: expiresAt });

    const log = createLog(tx, matchId, match);
    log.add('offer', `Posto offerto in sostituzione a ${next.data.nickname || 'una riserva'}`, {
      uid: next.id,
      nickname: next.data.nickname || '',
      actorId: actor?.uid || null,
    });

    tx.update(`matches/${matchId}`, {
      pendingOffer: {
        uid: next.id,
        nickname: next.data.nickname || '',
        seq: next.data.seq || 0,
        expiresAt,
        replacementFor: requesterUid,
        replacementRequestId: requesterUid,
      },
      pendingOfferUid: next.id,
      updatedAt: serverTimestamp(),
      logSeq: log.lastSeq,
    });

    return next.data.nickname || '';
  });
}

export async function cancelReplacementRequest({ matchId, uid }) {
  if (!matchId || !uid) return;
  await store.runTransaction(async (tx) => {
    const matchDoc = await tx.get(`matches/${matchId}`);
    if (!matchDoc) return;
    const match = matchDoc.data;
    const requestDoc = await tx.get(replacementPath(matchId, uid));
    if (!requestDoc) return;
    const offer = match.pendingOffer;
    const offeredUid = offer?.replacementFor === uid ? offer.uid : null;
    const offeredReg = offeredUid ? await tx.get(regPath(matchId, offeredUid)) : null;

    tx.delete(replacementPath(matchId, uid));

    const log = createLog(tx, matchId, match);
    log.add('replacement_withdraw', `${requestDoc.data.nickname || 'Un iscritto'} ha ritirato la richiesta di sostituzione`, {
      uid,
      nickname: requestDoc.data.nickname || '',
      actorId: uid,
    });

    const patch = { updatedAt: serverTimestamp() };
    if (offeredUid && offeredReg) {
      tx.update(regPath(matchId, offeredUid), { status: 'waitlist', offerExpiresAt: null });
      patch.pendingOffer = null;
      patch.pendingOfferUid = null;
      log.add('offer', `Offerta ritirata: ${offeredReg.data.nickname || 'la riserva'} torna in lista`, {
        uid: offeredUid,
        nickname: offeredReg.data.nickname || '',
        actorId: uid,
      });
    }
    tx.update(`matches/${matchId}`, { ...patch, logSeq: log.lastSeq });
  });
}

export async function resolveReplacementRequest({ matchId, uid, reviewerUid }) {
  if (!matchId || !uid) return;
  await store.runTransaction(async (tx) => {
    const matchDoc = await tx.get(`matches/${matchId}`);
    const requestDoc = await tx.get(replacementPath(matchId, uid));
    if (!matchDoc || !requestDoc) return;
    const match = matchDoc.data;
    tx.update(replacementPath(matchId, uid), {
      status: 'handled',
      handledAt: serverTimestamp(),
      handledBy: reviewerUid || null,
      updatedAt: serverTimestamp(),
    });
    const log = createLog(tx, matchId, match);
    log.add('replacement_handled', `Richiesta di sostituzione di ${requestDoc.data.nickname || 'un iscritto'} segnata come gestita`, {
      uid,
      nickname: requestDoc.data.nickname || '',
      actorId: reviewerUid || null,
    });
    tx.update(`matches/${matchId}`, { updatedAt: serverTimestamp(), logSeq: log.lastSeq });
  });
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
  return (
    rows
      .filter((row) => row.data.status === 'waitlist')
      .sort((a, b) => (a.data.seq || 0) - (b.data.seq || 0))[0] || null
  );
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
    const position =
      status === 'confirmed' ? (match.confirmedCount || 0) + 1 : (match.waitlistCount || 0) + 1;

    const log = createLog(tx, matchId, match);
    log.add(
      status === 'confirmed' ? 'signup' : 'waitlist',
      status === 'confirmed'
        ? `${nickname} si è iscritto (posto ${position}/${match.maxPlayers})`
        : `${nickname} è entrato in lista riserva (#${position})`,
      { uid: user.uid, nickname, actorId: user.uid }
    );

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
      ...(match.organizerId === user.uid ? { organizerOptOut: false } : {}),
      logSeq: log.lastSeq,
      updatedAt: serverTimestamp(),
    });

    return status;
  });
}

async function leaveMatch(matchId, uid, { skipDeadline = false, actor = null } = {}) {
  return store.runTransaction(async (tx) => {
    const matchDoc = await tx.get(`matches/${matchId}`);
    const regDoc = await tx.get(regPath(matchId, uid));
    if (!matchDoc) throw new Error('Match non trovato.');
    if (!regDoc) throw new Error('Iscrizione non trovata.');
    const match = matchDoc.data;
    const status = regDoc.data.status;
    const organizerLeaving = match.organizerId === uid;

    // La deadline blocca solo chi occupa un posto: dalla riserva si può uscire
    // anche dopo (chi non può più venire chiede la sostituzione). Chi organizza
    // il match o il fondatore del gruppo restano sempre liberi di uscire.
    if (!skipDeadline && status === 'confirmed' && match.organizerId !== uid) {
      const deadline = toDate(match.deadlineAt);
      if (deadline && deadline.getTime() < Date.now()) {
        throw new Error('Il termine per disiscriversi è passato: chiedi un sostituto.');
      }
    }

    const shouldPromote =
      status === 'offered' || (status === 'confirmed' && !match.pendingOffer);
    const next = shouldPromote ? await pickNextWaitlist(tx, matchId) : null;
    const replacementFor = match.pendingOffer?.replacementFor || null;
    const replacementRequestId = match.pendingOffer?.replacementRequestId || null;
    // Se esce proprio chi aveva chiesto la sostituzione, l'offerta in corso
    // diventa una normale offerta per il posto libero.
    const leavingRequester = Boolean(replacementFor) && replacementFor === uid;

    let confirmedCount = match.confirmedCount || 0;
    let waitlistCount = match.waitlistCount || 0;
    if (status === 'confirmed') confirmedCount = Math.max(0, confirmedCount - 1);
    else waitlistCount = Math.max(0, waitlistCount - 1);

    const log = createLog(tx, matchId, match);
    if (actor?.uid && actor.uid !== uid) {
      log.add(
        'remove',
        `${regDoc.data.nickname || 'Un iscritto'} è stato rimosso da ${actor.nickname || 'un organizzatore'}`,
        { uid, nickname: regDoc.data.nickname || '', actorId: actor.uid }
      );
    } else {
      log.add('cancel', `${regDoc.data.nickname || 'Un iscritto'} ha annullato l’iscrizione`, {
        uid,
        nickname: regDoc.data.nickname || '',
        actorId: uid,
      });
    }

    tx.delete(regPath(matchId, uid));

    const patch = {
      confirmedCount,
      waitlistCount,
      ...(organizerLeaving ? { organizerOptOut: true } : {}),
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
        ...(replacementFor && !leavingRequester
          ? { replacementFor, replacementRequestId }
          : {}),
      };
      patch.pendingOfferUid = next.data.uid;
      log.add('offer', `Posto offerto a ${next.data.nickname || 'una riserva'}`, {
        uid: next.data.uid,
        nickname: next.data.nickname || '',
        actorId: actor?.uid || uid,
      });
    } else if (leavingRequester && match.pendingOffer) {
      patch.pendingOffer = {
        ...match.pendingOffer,
        replacementFor: null,
        replacementRequestId: null,
      };
    }

    patch.logSeq = log.lastSeq;
    tx.update(`matches/${matchId}`, patch);
    return {
      status,
      promoted: next?.data?.nickname || null,
      promotedUid: next?.data?.uid || null,
      matchTitle: match.title || '',
    };
  });
}

/** Usato dalla manutenzione: se l'offerta è scaduta la rimuove e passa alla riserva successiva. */
export async function expirePendingOffer(matchId) {
  const result = await store.runTransaction(async (tx) => {
    const matchDoc = await tx.get(`matches/${matchId}`);
    if (!matchDoc) return false;
    const match = matchDoc.data;
    const offer = match.pendingOffer;
    if (!offer) return false;
    const expiresAt = toDate(offer.expiresAt);
    if (!expiresAt || expiresAt.getTime() > Date.now()) return false;

    const expiredReg = await tx.get(regPath(matchId, offer.uid));
    const next = await pickNextWaitlist(tx, matchId);
    const replacementFor = offer.replacementFor || null;
    const replacementRequestId = offer.replacementRequestId || null;

    const patch = {
      pendingOffer: null,
      pendingOfferUid: null,
      waitlistCount: Math.max(0, (match.waitlistCount || 0) - 1),
      updatedAt: serverTimestamp(),
    };

    const log = createLog(tx, matchId, match);
    log.add('offer_expired', `Offerta a ${offer.nickname || 'una riserva'} scaduta`, {
      uid: offer.uid,
      nickname: offer.nickname || '',
      actorId: null,
    });

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
        ...(replacementFor ? { replacementFor, replacementRequestId } : {}),
      };
      patch.pendingOfferUid = next.data.uid;
      log.add('offer', `Posto offerto a ${next.data.nickname || 'una riserva'}`, {
        uid: next.data.uid,
        nickname: next.data.nickname || '',
        actorId: null,
      });
    }

    patch.logSeq = log.lastSeq;
    tx.update(`matches/${matchId}`, patch);
    return {
      changed: true,
      promotedUid: next && next.id !== offer.uid ? next.data.uid : null,
      matchTitle: match.title || '',
    };
  });

  if (result?.promotedUid) {
    await queuePush({
      type: 'offer',
      title: 'Posto disponibile',
      body: `Hai 30 minuti per confermare il posto su ${result.matchTitle || 'questo match'}.`,
      url: `/match/${matchId}`,
      tag: `offerta-${matchId}`,
      audience: 'user',
      userId: result.promotedUid,
      matchId,
    });
  }

  return Boolean(result?.changed);
}

export async function cancelSignup({ matchId, uid, asManager = false }) {
  // Chi gestisce il match (organizzatore, fondatore del gruppo, admin) può
  // uscire anche dopo la deadline: prima restava bloccato.
  const result = await leaveMatch(matchId, uid, { skipDeadline: asManager });
  await notifyPromotedOffer(result, matchId);
  return result;
}

/** Rimozione da parte dell'organizzatore (o admin): nessun limite di deadline. */
export async function removeParticipant({ matchId, uid, actor = null }) {
  const result = await leaveMatch(matchId, uid, { skipDeadline: true, actor });
  await notifyPromotedOffer(result, matchId);
  // Se c'era una richiesta di sostituzione, la rimozione la chiude.
  try {
    await store.updateDoc(replacementPath(matchId, uid), {
      status: 'handled',
      handledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Nessuna richiesta aperta: niente da aggiornare.
  }
  return result;
}

/** Avvisa chi è appena passato dalla lista riserve al posto offerto. */
async function notifyPromotedOffer(result, matchId) {
  if (!result?.promotedUid) return;
  await queuePush({
    type: 'offer',
    title: 'Posto disponibile',
    body: `Hai 30 minuti per confermare il posto su ${result.matchTitle || 'questo match'}.`,
    url: `/match/${matchId}`,
    tag: `offerta-${matchId}`,
    audience: 'user',
    userId: result.promotedUid,
    matchId,
  });
}

export async function confirmSeat({ matchId, uid }) {
  return store.runTransaction(async (tx) => {
    const matchDoc = await tx.get(`matches/${matchId}`);
    const regDoc = await tx.get(regPath(matchId, uid));
    if (!matchDoc || !regDoc) throw new Error('Posto riservato non trovato.');
    const match = matchDoc.data;
    const offer = match.pendingOffer;
    if (!offer || offer.uid !== uid) {
      throw new Error('Non c’è nessun posto riservato per te su questo match.');
    }
    const expiresAt = toDate(offer.expiresAt);
    if (expiresAt && expiresAt.getTime() < Date.now() - 60000) {
      throw new Error('Tempo scaduto: il posto è stato riassegnato.');
    }

    // Sostituzione: chi ha chiesto il cambio resta iscritto fino a questo
    // momento, ora esce e l'offerta diventa un'iscrizione confermata.
    const replacementFor = offer.replacementFor || null;
    const replacedReg = replacementFor ? await tx.get(regPath(matchId, replacementFor)) : null;
    const requestDoc = replacementFor
      ? await tx.get(replacementPath(matchId, replacementFor))
      : null;

    const log = createLog(tx, matchId, match);
    const who = regDoc.data.nickname || 'Una riserva';

    if (replacementFor) {
      if (replacedReg) tx.delete(regPath(matchId, replacementFor));
      tx.update(regPath(matchId, uid), {
        status: 'confirmed',
        confirmedAt: serverTimestamp(),
        offerExpiresAt: null,
      });
      if (requestDoc) {
        tx.update(replacementPath(matchId, replacementFor), {
          status: 'filled',
          filledBy: uid,
          filledAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      log.add(
        'replacement',
        `${who} prende il posto di ${replacedReg?.data?.nickname || 'un iscritto'} (sostituzione accettata)`,
        { uid, nickname: who, actorId: uid }
      );
      tx.update(`matches/${matchId}`, {
        waitlistCount: Math.max(0, (match.waitlistCount || 0) - 1),
        pendingOffer: null,
        pendingOfferUid: null,
        updatedAt: serverTimestamp(),
        logSeq: log.lastSeq,
      });
      return;
    }

    tx.update(regPath(matchId, uid), {
      status: 'confirmed',
      confirmedAt: serverTimestamp(),
      offerExpiresAt: null,
    });
    log.add('confirm', `${who} ha confermato il posto`, {
      uid,
      nickname: who,
      actorId: uid,
    });
    tx.update(`matches/${matchId}`, {
      confirmedCount: (match.confirmedCount || 0) + 1,
      waitlistCount: Math.max(0, (match.waitlistCount || 0) - 1),
      pendingOffer: null,
      pendingOfferUid: null,
      updatedAt: serverTimestamp(),
      logSeq: log.lastSeq,
    });
  });
}

export async function declineSeat({ matchId, uid }) {
  const result = await store.runTransaction(async (tx) => {
    const matchDoc = await tx.get(`matches/${matchId}`);
    const regDoc = await tx.get(regPath(matchId, uid));
    if (!matchDoc || !regDoc) throw new Error('Posto riservato non trovato.');
    const match = matchDoc.data;
    if (!match.pendingOffer || match.pendingOffer.uid !== uid) {
      throw new Error('Non c’è nessun posto riservato per te su questo match.');
    }
    const next = await pickNextWaitlist(tx, matchId);
    const waitlistCount = Math.max(0, (match.waitlistCount || 0) - 1);
    const replacementFor = match.pendingOffer?.replacementFor || null;
    const replacementRequestId = match.pendingOffer?.replacementRequestId || null;

    const log = createLog(tx, matchId, match);
    log.add(
      'decline',
      `${regDoc.data.nickname || 'Una riserva'} ha rifiutato l’offerta`,
      { uid, nickname: regDoc.data.nickname || '', actorId: uid }
    );

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
        ...(replacementFor ? { replacementFor, replacementRequestId } : {}),
      };
      patch.pendingOfferUid = next.data.uid;
      log.add('offer', `Posto offerto a ${next.data.nickname || 'una riserva'}`, {
        uid: next.data.uid,
        nickname: next.data.nickname || '',
        actorId: uid,
      });
    }
    patch.logSeq = log.lastSeq;
    tx.update(`matches/${matchId}`, patch);
    return {
      promotedUid: next && next.id !== uid ? next.data.uid : null,
      matchTitle: match.title || '',
    };
  });

  await notifyPromotedOffer(result, matchId);
  return result;
}

function normalizeMatchInput(input) {
  const startsAt = toDate(input.startsAt) || new Date(input.startsAt);
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

export async function createMatch(
  input,
  organizer,
  { recurring = false, recurrence = null, group = null, actorIsAdmin = false } = {}
) {
  if (group?.id) {
    const membership = await store.getDoc(`groups/${group.id}/members/${organizer.uid}`);
    if (membership?.data?.status !== 'active') {
      throw new Error('Solo i membri attivi possono proporre un match in questo gruppo.');
    }
    const policy = group.matchOrganizersPolicy === 'admins' ? 'admins' : 'all';
    if (policy === 'admins' && group.ownerId !== organizer.uid && !actorIsAdmin) {
      throw new Error('In questo gruppo solo il fondatore e gli admin possono organizzare i match.');
    }
  }

  const data = normalizeMatchInput(input);
  const isGroupPrivate = group?.visibility === 'private';
  const matchId = await store.addDoc('matches', {
    ...data,
    organizerId: organizer.uid,
    organizerNickname: organizer.nickname,
    groupId: group?.id || null,
    groupName: group?.name || '',
    groupVisibility: group?.visibility || null,
    visibility: isGroupPrivate ? 'group-private' : 'public',
    confirmedCount: 0,
    waitlistCount: 0,
    registrationSeq: 0,
    pendingOffer: null,
    pendingOfferUid: null,
    status: 'open',
    organizerOptOut: false,
    recurringId: null,
    chatMessageId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // L'organizzatore è il primo iscritto: può comunque rimuoversi in seguito.
  let confirmedCount = 0;
  try {
    await store.runTransaction(async (tx) => {
      tx.set(regPath(matchId, organizer.uid), {
        uid: organizer.uid,
        nickname: organizer.nickname,
        status: 'confirmed',
        seq: 1,
        createdAt: serverTimestamp(),
        confirmedAt: serverTimestamp(),
        offerExpiresAt: null,
      });
      tx.update(`matches/${matchId}`, {
        confirmedCount: 1,
        registrationSeq: 1,
        updatedAt: serverTimestamp(),
      });
    });
    confirmedCount = 1;
  } catch (error) {
    console.warn('Organizzatore non aggiunto automaticamente', error?.message);
  }

  if (group?.id) {
    try {
      await postMatchProposalToGroup({
        groupId: group.id,
        organizer,
        matchId,
        match: {
          ...data,
          organizerNickname: organizer.nickname,
          confirmedCount,
          waitlistCount: 0,
          status: 'open',
        },
      });
    } catch (error) {
      console.warn('Match creato ma non pubblicato nella chat del gruppo', error?.message);
    }
  }

  // Solo i match pubblici finiscono nella chat generale.
  if (!isGroupPrivate) {
    try {
      const messageId = await postMatchProposal({
        organizer,
        matchId,
        match: {
          ...data,
          organizerNickname: organizer.nickname,
          confirmedCount,
          waitlistCount: 0,
          status: 'open',
        },
      });
      await store.updateDoc(`matches/${matchId}`, { chatMessageId: messageId });
    } catch (error) {
      console.warn('Match creato ma non pubblicato nella chat generale', error?.message);
    }
  }

  if (recurring) {
    const frequency = ['weekly', 'biweekly', 'monthly'].includes(recurrence?.frequency)
      ? recurrence.frequency
      : 'weekly';
    const approvalMode = recurrence?.approvalMode === 'founder' ? 'founder' : 'auto';
    await store.setDoc(`recurringMatches/${`rec-${matchId}`}`, {
      organizerId: organizer.uid,
      organizerNickname: organizer.nickname,
      title: data.title,
      sport: data.sport,
      weekday: data.startsAt.getDay(),
      anchorDate: data.date,
      anchorDay: data.startsAt.getDate(),
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
      groupId: group?.id || null,
      groupName: group?.name || '',
      groupVisibility: group?.visibility || null,
      visibility: isGroupPrivate ? 'group-private' : 'public',
      frequency,
      approvalMode,
      active: true,
      lastPublishedDate: null,
      createdAt: serverTimestamp(),
    });
    await store.updateDoc(`matches/${matchId}`, { recurringId: `rec-${matchId}` });
  }

  await queuePush({
    type: 'match',
    title: 'Nuovo match',
    body: `${data.title} · ${data.gym}`,
    url: `/match/${matchId}`,
    tag: `match-${matchId}`,
    audience: isGroupPrivate ? 'group' : 'all',
    groupId: group?.id || null,
    matchId,
    actorId: organizer.uid,
  });

  return matchId;
}

export async function ensureOrganizerRegistration({ matchId, match, organizer }) {
  if (!matchId || !match || !organizer?.uid) return false;
  if (match.organizerId !== organizer.uid || match.organizerOptOut) return false;
  if (match.status !== 'open') return false;
  const start = toDate(match.startsAt);
  if (start && start.getTime() < Date.now()) return false;

  return store.runTransaction(async (tx) => {
    const freshMatch = await tx.get(`matches/${matchId}`);
    if (!freshMatch) return false;
    const data = freshMatch.data;
    if (data.organizerId !== organizer.uid || data.organizerOptOut || data.status !== 'open') {
      return false;
    }
    const startDate = toDate(data.startsAt);
    if (startDate && startDate.getTime() < Date.now()) return false;
    if ((data.confirmedCount || 0) >= (data.maxPlayers || 0)) return false;

    const existing = await tx.get(regPath(matchId, organizer.uid));
    if (existing) return false;

    const seq = (data.registrationSeq || 0) + 1;
    const log = createLog(tx, matchId, data);
    log.add(
      'signup',
      `${organizer.nickname} (organizzatore) è iscritto d’ufficio`,
      { uid: organizer.uid, nickname: organizer.nickname, actorId: organizer.uid }
    );
    tx.set(regPath(matchId, organizer.uid), {
      uid: organizer.uid,
      nickname: organizer.nickname,
      status: 'confirmed',
      seq,
      createdAt: serverTimestamp(),
      confirmedAt: serverTimestamp(),
      offerExpiresAt: null,
    });
    tx.update(`matches/${matchId}`, {
      registrationSeq: seq,
      confirmedCount: (data.confirmedCount || 0) + 1,
      logSeq: log.lastSeq,
      updatedAt: serverTimestamp(),
    });
    return true;
  });
}

export async function publishMatchToChat({ matchId, match, organizer }) {
  if (!matchId || !organizer?.uid) throw new Error('Match non valido.');
  if (match?.visibility === 'group-private') {
    throw new Error('I match dei gruppi privati non vengono pubblicati nella chat generale.');
  }
  if (match?.chatMessageId) return { created: false, messageId: match.chatMessageId };
  const messageId = await postMatchProposal({ organizer, matchId, match });
  await store.updateDoc(`matches/${matchId}`, { chatMessageId: messageId });
  return { created: true, messageId };
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

export function subscribeRecurringApprovals(organizerId, callback) {
  return store.subscribeList(
    'recurringApprovals',
    {
      where: [
        ['organizerId', '==', organizerId],
        ['status', '==', 'pending'],
      ],
      orderBy: [['proposedAt', 'asc']],
      limit: 50,
    },
    callback
  );
}

/** Approva una riproposta: crea il match e lo pubblica secondo la visibilità del gruppo. */
export async function approveRecurringApproval({ approval, organizer }) {
  const source = approval?.data;
  if (!approval?.id || !source?.match) throw new Error('Riproposta non valida.');
  if (source.status !== 'pending') throw new Error('Questa riproposta è già stata gestita.');
  const group = source.groupId
    ? {
        id: source.groupId,
        name: source.groupName || 'Gruppo',
        visibility: source.visibility === 'group-private' ? 'private' : 'public',
      }
    : null;
  const matchId = await createMatch(source.match, organizer, { group });
  await store.updateDoc(`recurringApprovals/${approval.id}`, {
    status: 'approved',
    matchId,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return matchId;
}

export async function rejectRecurringApproval({ approvalId }) {
  await store.updateDoc(`recurringApprovals/${approvalId}`, {
    status: 'rejected',
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function listMyRegistrations(uid) {
  const matches = await listUpcomingMatches({ limit: 30, includeGroupPrivate: true });
  const rows = await Promise.all(
    matches.map(async (match) => {
      const reg = await store.getDoc(regPath(match.id, uid));
      return reg ? { match: { id: match.id, ...match.data }, reg: reg.data } : null;
    })
  );
  return rows.filter(Boolean);
}
