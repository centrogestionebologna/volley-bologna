import { store } from '../backend';
import { serverTimestamp } from '../store/base';
import { sha256Hex, generateInviteCode } from '../lib/crypto';

const memberPath = (groupId, uid) => `groups/${groupId}/members/${uid}`;

export function subscribeGroups(callback) {
  return store.subscribeList('groups', { orderBy: [['createdAt', 'desc']], limit: 100 }, callback);
}

export async function getGroup(groupId) {
  return store.getDoc(`groups/${groupId}`);
}

export function subscribeGroup(groupId, callback) {
  return store.subscribeDoc(`groups/${groupId}`, callback);
}

export function subscribeMembers(groupId, callback) {
  return store.subscribeList(
    memberPath(groupId, '').replace(/\/$/, ''),
    { orderBy: [['joinedAt', 'asc']], limit: 200 },
    callback
  );
}

export function subscribeMembership(groupId, uid, callback) {
  return store.subscribeDoc(memberPath(groupId, uid), callback);
}

export async function getMembership(groupId, uid) {
  return store.getDoc(memberPath(groupId, uid));
}

export async function createGroup({ name, description = '', visibility, owner }) {
  if (!owner?.uid) throw new Error('Sessione non valida: ricarica la pagina e riprova.');
  const cleanName = String(name || '').trim();
  if (cleanName.length < 3) throw new Error('Il nome del gruppo deve avere almeno 3 caratteri.');
  const isPrivate = visibility === 'private';
  const ownerNickname = owner.nickname || 'Fondatore';
  let groupId = null;
  let inviteCode = null;

  try {
    groupId = await store.addDoc('groups', {
      name: cleanName.slice(0, 80),
      description: String(description || '').trim().slice(0, 400),
      visibility: isPrivate ? 'private' : 'public',
      ownerId: owner.uid,
      ownerNickname,
      memberCount: 1,
      pendingCount: 0,
      bannedUids: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Per i gruppi privati il segreto deve esistere prima della membership:
    // le regole verificano che l'invito del fondatore corrisponda al segreto.
    let inviteHash = null;
    if (isPrivate) {
      inviteCode = generateInviteCode();
      inviteHash = await sha256Hex(inviteCode);
      await store.setDoc(`groupSecrets/${groupId}`, {
        ownerId: owner.uid,
        inviteCode,
        inviteHash,
        updatedAt: serverTimestamp(),
      });
    }

    await store.setDoc(memberPath(groupId, owner.uid), {
      uid: owner.uid,
      nickname: ownerNickname,
      role: 'owner',
      status: 'active',
      inviteHash,
      joinedAt: serverTimestamp(),
    });

    return { id: groupId, inviteCode };
  } catch (error) {
    if (groupId) {
      // Se una delle scritture fallisce, non lasciamo un gruppo senza fondatore.
      try {
        await store.deleteDoc(`groupSecrets/${groupId}`);
      } catch {}
      try {
        await store.deleteDoc(memberPath(groupId, owner.uid));
      } catch {}
      try {
        await store.deleteDoc(`groups/${groupId}`);
      } catch {}
    }
    throw error;
  }
}

export async function joinGroup({ groupId, user, inviteCode = '' }) {
  const invite = String(inviteCode || '').trim();
  return store.runTransaction(async (tx) => {
    const groupDoc = await tx.get(`groups/${groupId}`);
    if (!groupDoc) throw new Error('Gruppo non trovato.');
    const group = groupDoc.data;
    if ((group.bannedUids || []).includes(user.uid)) {
      throw new Error('Accesso negato: sei stato bannato da questo gruppo.');
    }
    const existing = await tx.get(memberPath(groupId, user.uid));
    if (existing?.data?.status === 'active') return 'active';
    if (existing?.data?.status === 'pending' && !invite) return 'pending';

    let status = group.visibility === 'private' ? 'pending' : 'active';
    let inviteHash = null;
    if (invite) {
      inviteHash = await sha256Hex(invite);
      status = 'active';
    }

    tx.set(memberPath(groupId, user.uid), {
      uid: user.uid,
      nickname: user.nickname,
      role: existing?.data?.role === 'owner' ? 'owner' : 'member',
      status,
      joinedAt: existing?.data?.joinedAt || serverTimestamp(),
      inviteHash,
    });

    if (status === 'active') {
      tx.update(`groups/${groupId}`, {
        memberCount: Math.max(1, (group.memberCount || 1) + (existing ? 0 : 1)),
        pendingCount: Math.max(0, (group.pendingCount || 0) - (existing?.data?.status === 'pending' ? 1 : 0)),
        updatedAt: serverTimestamp(),
      });
    } else {
      tx.update(`groups/${groupId}`, {
        pendingCount: (group.pendingCount || 0) + (existing ? 0 : 1),
        updatedAt: serverTimestamp(),
      });
    }

    return status;
  });
}

export async function approveMember({ groupId, uid }) {
  return store.runTransaction(async (tx) => {
    const [groupDoc, memberDoc] = await Promise.all([
      tx.get(`groups/${groupId}`),
      tx.get(memberPath(groupId, uid)),
    ]);
    if (!groupDoc || !memberDoc) throw new Error('Richiesta non trovata.');
    if (memberDoc.data.status === 'active') return;
    tx.update(memberPath(groupId, uid), { status: 'active' });
    tx.update(`groups/${groupId}`, {
      memberCount: (groupDoc.data.memberCount || 1) + 1,
      pendingCount: Math.max(0, (groupDoc.data.pendingCount || 0) - 1),
      updatedAt: serverTimestamp(),
    });
  });
}

export async function rejectMember({ groupId, uid }) {
  return store.runTransaction(async (tx) => {
    const [groupDoc, memberDoc] = await Promise.all([
      tx.get(`groups/${groupId}`),
      tx.get(memberPath(groupId, uid)),
    ]);
    if (!memberDoc) return;
    tx.delete(memberPath(groupId, uid));
    tx.update(`groups/${groupId}`, {
      pendingCount: Math.max(0, (groupDoc?.data.pendingCount || 0) - (memberDoc.data.status === 'pending' ? 1 : 0)),
      memberCount: Math.max(1, (groupDoc?.data.memberCount || 1) - (memberDoc.data.status === 'active' ? 1 : 0)),
      updatedAt: serverTimestamp(),
    });
  });
}

export async function leaveGroup({ groupId, uid }) {
  return store.runTransaction(async (tx) => {
    const groupDoc = await tx.get(`groups/${groupId}`);
    const memberDoc = await tx.get(memberPath(groupId, uid));
    if (!groupDoc || !memberDoc) return;
    if (memberDoc.data.role === 'owner') {
      throw new Error('Il fondatore non può lasciare il gruppo: può eliminarlo o trasferirlo.');
    }
    tx.delete(memberPath(groupId, uid));
    tx.update(`groups/${groupId}`, {
      memberCount: Math.max(1, (groupDoc.data.memberCount || 1) - (memberDoc.data.status === 'active' ? 1 : 0)),
      pendingCount: Math.max(0, (groupDoc.data.pendingCount || 0) - (memberDoc.data.status === 'pending' ? 1 : 0)),
      updatedAt: serverTimestamp(),
    });
  });
}

export async function setGroupBan({ groupId, targetUid, banned, actorUid, actorIsAdmin = false }) {
  return store.runTransaction(async (tx) => {
    const groupDoc = await tx.get(`groups/${groupId}`);
    if (!groupDoc) throw new Error('Gruppo non trovato.');
    const group = groupDoc.data;
    if (!actorIsAdmin && group.ownerId !== actorUid) throw new Error('Solo il fondatore può moderare il gruppo.');
    const members = Array.isArray(group.bannedUids) ? group.bannedUids : [];
    const next = banned ? [...new Set([...members, targetUid])] : members.filter((uid) => uid !== targetUid);

    const memberDoc = await tx.get(memberPath(groupId, targetUid));
    let memberCount = group.memberCount || 1;
    let pendingCount = group.pendingCount || 0;
    if (banned && memberDoc) {
      tx.delete(memberPath(groupId, targetUid));
      if (memberDoc.data.status === 'active') memberCount = Math.max(1, memberCount - 1);
      if (memberDoc.data.status === 'pending') pendingCount = Math.max(0, pendingCount - 1);
    }
    tx.update(`groups/${groupId}`, {
      bannedUids: next,
      memberCount,
      pendingCount,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function getGroupSecret(groupId) {
  return store.getDoc(`groupSecrets/${groupId}`);
}

export async function regenerateInvite(groupId, ownerId) {
  const code = generateInviteCode();
  await store.setDoc(
    `groupSecrets/${groupId}`,
    {
      ownerId,
      inviteCode: code,
      inviteHash: await sha256Hex(code),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  return code;
}

export async function deleteGroup(groupId) {
  await store.deleteDoc(`groups/${groupId}`);
}
