import { store } from '../backend';
import { serverTimestamp } from '../store/base';
import { toDate } from '../lib/format';

const IDENTITY_ACCESS_DAYS = 7;

const normalize = (value = '') =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Restituisce la parola vietata trovata nel testo, oppure null. */
export function findBannedWord(text, bannedWords = []) {
  const normalized = normalize(text).replace(/\s+/g, ' ');
  for (const raw of bannedWords) {
    const word = normalize(String(raw)).trim();
    if (!word) continue;
    if (word.includes(' ')) {
      if (normalized.includes(word)) return raw;
    } else {
      const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(word)}([^a-z0-9]|$)`, 'i');
      if (pattern.test(normalized)) return raw;
    }
  }
  return null;
}

export async function getModerationSettings() {
  const doc = await store.getDoc('settings/moderation');
  return {
    bannedWords: doc?.data?.bannedWords || [],
    updatedAt: doc?.data?.updatedAt || null,
  };
}

export function subscribeModerationSettings(callback) {
  return store.subscribeDoc('settings/moderation', (doc) =>
    callback({ bannedWords: doc?.data?.bannedWords || [], updatedAt: doc?.data?.updatedAt || null })
  );
}

export async function saveBannedWords(words) {
  const clean = [...new Set(words.map((w) => w.trim().toLowerCase()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'it')
  );
  await store.setDoc(
    'settings/moderation',
    { bannedWords: clean, updatedAt: serverTimestamp() },
    { merge: true }
  );
  return clean;
}

/** Segnalazione di un messaggio, di un utente o irregolarità su un match. */
export async function createReport({
  type,
  reason,
  targetId = '',
  targetUserId = '',
  targetNickname = '',
  messageText = '',
  chatPath = '',
  reporter,
  matchId = '',
}) {
  if (!reason?.trim()) throw new Error('Indica il motivo della segnalazione.');
  const reportId = await store.addDoc('reports', {
    type,
    targetId,
    targetUserId,
    targetNickname,
    messageText: messageText.slice(0, 500),
    chatPath,
    matchId,
    reporterId: reporter.uid,
    reporterNickname: reporter.nickname,
    reason: reason.trim().slice(0, 600),
    status: 'open',
    createdAt: serverTimestamp(),
    resolvedAt: null,
    resolution: '',
  });

  // In caso di irregolarità l'organizzatore ottiene accesso temporaneo ai
  // dati reali dell'utente segnalato (verificato dalle regole di sicurezza).
  if (targetUserId && (type === 'irregularity' || type === 'user')) {
    await store.setDoc(`identityAccess/${reporter.uid}_${targetUserId}`, {
      organizerId: reporter.uid,
      userId: targetUserId,
      reportId,
      createdAt: serverTimestamp(),
      expiresAt: new Date(Date.now() + IDENTITY_ACCESS_DAYS * 86400000),
    });
  }

  return reportId;
}

export async function hasIdentityAccess(organizerId, userId) {
  if (!organizerId || !userId) return false;
  const doc = await store.getDoc(`identityAccess/${organizerId}_${userId}`);
  if (!doc) return false;
  const expiresAt = toDate(doc.data.expiresAt);
  return Boolean(expiresAt && expiresAt.getTime() > Date.now());
}

export async function listReports({ status = 'open', limit = 100 } = {}) {
  const where = status ? [['status', '==', status]] : [];
  return store.listDocs('reports', {
    where,
    orderBy: [['createdAt', 'desc']],
    limit,
  });
}

export async function resolveReport(reportId, { status = 'resolved', resolution = '' }) {
  await store.updateDoc(`reports/${reportId}`, {
    status,
    resolution: resolution.trim().slice(0, 600),
    resolvedAt: serverTimestamp(),
  });
}

export async function banUser(uid, reason = 'Violazione delle regole della community') {
  await store.updateDoc(`users/${uid}`, {
    banned: true,
    banReason: reason,
    bannedAt: serverTimestamp(),
    silencedUntil: null,
    updatedAt: serverTimestamp(),
  });
}

export async function unbanUser(uid) {
  await store.updateDoc(`users/${uid}`, {
    banned: false,
    banReason: '',
    bannedAt: null,
    updatedAt: serverTimestamp(),
  });
}

export async function silenceUser(uid, hours, reason = '') {
  const until = hours > 0 ? new Date(Date.now() + hours * 3600000) : null;
  await store.updateDoc(`users/${uid}`, {
    silencedUntil: until,
    silenceReason: reason,
    updatedAt: serverTimestamp(),
  });
}

export async function requestVerificationFromUser(uid) {
  await store.updateDoc(`users/${uid}`, {
    verificationStatus: 'requested',
    verificationNote: 'L’amministratore ha richiesto una verifica manuale dell’identità.',
    updatedAt: serverTimestamp(),
  });
}

export async function approveVerification(uid) {
  await store.updateDoc(`users/${uid}`, {
    verified: true,
    verificationStatus: 'verified',
    verificationNote: '',
    updatedAt: serverTimestamp(),
  });
  await store.updateDoc(`publicProfiles/${uid}`, { verified: true });
}

export async function rejectVerification(uid, note = '') {
  await store.updateDoc(`users/${uid}`, {
    verified: false,
    verificationStatus: 'none',
    verificationNote: note || 'Verifica non approvata.',
    updatedAt: serverTimestamp(),
  });
  await store.updateDoc(`publicProfiles/${uid}`, { verified: false });
}

export async function setAdminRole(uid, makeAdmin) {
  if (makeAdmin) {
    await store.setDoc(`admins/${uid}`, { uid, createdAt: serverTimestamp() });
  } else {
    await store.deleteDoc(`admins/${uid}`);
  }
}

export async function createDispute({ organizer, targetUserId, targetNickname, matchId, description }) {
  await store.addDoc('disputes', {
    organizerId: organizer.uid,
    organizerNickname: organizer.nickname,
    targetUserId,
    targetNickname,
    matchId: matchId || '',
    description: description.trim().slice(0, 800),
    status: 'open',
    createdAt: serverTimestamp(),
  });
}

export async function listDisputes({ limit = 100 } = {}) {
  return store.listDocs('disputes', { orderBy: [['createdAt', 'desc']], limit });
}
