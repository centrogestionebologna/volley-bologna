import { store } from '../backend';
import { DEFAULT_GROUP_SETTINGS, normalizeGroupSettings } from '../config';
import { serverTimestamp } from '../store/base';
import { sha256Hex, generateInviteCode, normalizeInviteCode } from '../lib/crypto';
import { queuePush } from './push';

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

export async function createGroup({ name, description = '', visibility, owner, actorIsAdmin = false }) {
  if (!owner?.uid) throw new Error('Sessione non valida: ricarica la pagina e riprova.');
  const cleanName = String(name || '').trim();
  if (cleanName.length < 3) throw new Error('Il nome del gruppo deve avere almeno 3 caratteri.');
  const isPrivate = visibility === 'private';
  if (!isPrivate && !actorIsAdmin) {
    throw new Error('Solo gli amministratori possono creare gruppi pubblici. Puoi inviare una proposta.');
  }
  const ownerNickname = owner.nickname || 'Fondatore';
  let groupId = null;
  let inviteCode = null;
  let inviteHash = null;

  try {
    groupId = await store.addDoc('groups', {
      name: cleanName.slice(0, 80),
      description: String(description || '').trim().slice(0, 400),
      visibility: isPrivate ? 'private' : 'public',
      ...normalizeGroupSettings(DEFAULT_GROUP_SETTINGS),
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
    if (isPrivate) {
      inviteCode = generateInviteCode();
      inviteHash = await sha256Hex(inviteCode);
      await store.setDoc(`groupSecrets/${groupId}`, {
        ownerId: owner.uid,
        inviteCode,
        inviteHash,
        updatedAt: serverTimestamp(),
      });
      // Indice pubblico per ritrovare il gruppo partendo dal solo codice.
      await store.setDoc(`groupInvites/${inviteHash}`, {
        groupId,
        ownerId: owner.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await store.setDoc(memberPath(groupId, owner.uid), {
      uid: owner.uid,
      nickname: ownerNickname,
      role: 'owner',
      status: 'active',
      inviteHash: null,
      joinedAt: serverTimestamp(),
    });

    return { id: groupId, inviteCode };
  } catch (error) {
    if (groupId) {
      // Se una delle scritture fallisce, non lasciamo un gruppo senza fondatore.
      try {
        if (inviteHash) await store.deleteDoc(`groupInvites/${inviteHash}`);
      } catch {}
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
  const invite = normalizeInviteCode(inviteCode);
  let pendingNotify = null;
  const status = await store.runTransaction(async (tx) => {
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
      status = group.visibility === 'private' && group.approveNewMembers === true ? 'pending' : 'active';
    }
    pendingNotify = status === 'pending'
      ? { ownerId: group.ownerId, groupName: group.name || 'Gruppo' }
      : null;

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

  if (status === 'pending' && pendingNotify?.ownerId) {
    await queuePush({
      type: 'group',
      title: 'Nuova richiesta di accesso',
      body: `${user.nickname || 'Un utente'} vuole entrare in ${pendingNotify.groupName}.`,
      url: `/gruppi/${groupId}`,
      tag: `gruppo-${groupId}`,
      audience: 'user',
      userId: pendingNotify.ownerId,
      actorId: user.uid,
    });
  }

  return status;
}

export async function joinGroupByCode({ code, user }) {
  const invite = normalizeInviteCode(code);
  if (!invite) throw new Error('Inserisci il codice invito.');
  const inviteHash = await sha256Hex(invite);
  const lookup = await store.getDoc(`groupInvites/${inviteHash}`);
  const groupId = lookup?.data?.groupId;
  if (!groupId) throw new Error('Codice invito non valido o non più attivo.');
  const status = await joinGroup({ groupId, user, inviteCode: invite });
  return { groupId, status };
}

export async function ensureInviteIndex({ groupId, inviteCode, ownerId }) {
  const invite = normalizeInviteCode(inviteCode);
  if (!groupId || !invite) return null;
  const inviteHash = await sha256Hex(invite);
  const existing = await store.getDoc(`groupInvites/${inviteHash}`).catch(() => null);
  if (existing?.data?.groupId === groupId) return inviteHash;
  await store.setDoc(
    `groupInvites/${inviteHash}`,
    {
      groupId,
      ownerId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  return inviteHash;
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

export async function updateGroupDetails({
  groupId,
  name,
  description = '',
  icon = '',
  settings = {},
  actorUid,
  actorIsAdmin = false,
  actorIsMember = false,
}) {
  const groupDoc = await store.getDoc(`groups/${groupId}`);
  if (!groupDoc) throw new Error('Gruppo non trovato.');
  const group = groupDoc.data;
  const current = normalizeGroupSettings(group);
  const isOwner = group.ownerId === actorUid;
  const canEditInfo =
    isOwner || actorIsAdmin || (actorIsMember && current.editInfoPolicy === 'all');
  if (!canEditInfo) throw new Error('Non hai i permessi per modificare questo gruppo.');

  const cleanName = String(name || '').trim();
  if (cleanName.length < 3) throw new Error('Il nome del gruppo deve avere almeno 3 caratteri.');
  const cleanDescription = String(description || '').trim().slice(0, 400);
  const merged = normalizeGroupSettings({ ...current, ...settings, icon });
  const patch = {
    name: cleanName.slice(0, 80),
    description: cleanDescription,
    icon: merged.icon,
    updatedAt: serverTimestamp(),
  };

  if (isOwner || actorIsAdmin) {
    Object.assign(patch, {
      sendMessagesPolicy: merged.sendMessagesPolicy,
      editInfoPolicy: merged.editInfoPolicy,
      addMembersPolicy: merged.addMembersPolicy,
      approveNewMembers: merged.approveNewMembers,
      disappearingMessages: merged.disappearingMessages,
    });
  }

  await store.updateDoc(`groups/${groupId}`, patch);
  return merged;
}

export function subscribeGroupProposals(callback) {
  return store.subscribeList(
    'groupProposals',
    {
      where: [['status', '==', 'pending']],
      orderBy: [['createdAt', 'asc']],
      limit: 50,
    },
    callback
  );
}

export function subscribeMyGroupProposals(uid, callback) {
  if (!uid) return () => {};
  return store.subscribeList(
    'groupProposals',
    {
      where: [['proposedBy', '==', uid]],
      orderBy: [['createdAt', 'desc']],
      limit: 20,
    },
    callback
  );
}

export async function createGroupProposal({ name, description = '', user }) {
  if (!user?.uid) throw new Error('Sessione non valida: ricarica la pagina e riprova.');
  const cleanName = String(name || '').trim();
  if (cleanName.length < 3) throw new Error('Il nome del gruppo deve avere almeno 3 caratteri.');
  const id = await store.addDoc('groupProposals', {
    name: cleanName.slice(0, 80),
    description: String(description || '').trim().slice(0, 400),
    visibility: 'public',
    status: 'pending',
    proposedBy: user.uid,
    proposedByNickname: user.nickname || 'Utente',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id };
}

export async function approveGroupProposal({
  proposalId,
  proposal,
  actorUid,
  actorIsAdmin = false,
}) {
  if (!actorIsAdmin) throw new Error('Solo gli amministratori possono approvare le proposte.');
  if (!proposal?.proposedBy) throw new Error('Proposta non valida.');

  const created = await createGroup({
    name: proposal.name,
    description: proposal.description || '',
    visibility: 'public',
    owner: { uid: proposal.proposedBy, nickname: proposal.proposedByNickname || 'Utente' },
    actorIsAdmin: true,
  });

  try {
    await store.updateDoc(`groupProposals/${proposalId}`, {
      status: 'approved',
      groupId: created.id,
      reviewedAt: serverTimestamp(),
      reviewedBy: actorUid || null,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    try {
      await deleteGroup(created.id);
    } catch {}
    throw error;
  }

  return created;
}

export async function rejectGroupProposal({ proposalId, actorUid, actorIsAdmin = false }) {
  if (!actorIsAdmin) throw new Error('Solo gli amministratori possono rifiutare le proposte.');
  await store.updateDoc(`groupProposals/${proposalId}`, {
    status: 'rejected',
    reviewedAt: serverTimestamp(),
    reviewedBy: actorUid || null,
    updatedAt: serverTimestamp(),
  });
}

export async function getGroupSecret(groupId) {
  return store.getDoc(`groupSecrets/${groupId}`);
}

export async function regenerateInvite(groupId, ownerId) {
  const previous = await store.getDoc(`groupSecrets/${groupId}`).catch(() => null);
  const code = generateInviteCode();
  const inviteHash = await sha256Hex(code);
  await store.setDoc(
    `groupSecrets/${groupId}`,
    {
      ownerId,
      inviteCode: code,
      inviteHash,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  await store.setDoc(`groupInvites/${inviteHash}`, {
    groupId,
    ownerId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  if (previous?.data?.inviteHash && previous.data.inviteHash !== inviteHash) {
    try {
      await store.deleteDoc(`groupInvites/${previous.data.inviteHash}`);
    } catch {}
  }
  return code;
}

export async function deleteGroup(groupId) {
  const secret = await store.getDoc(`groupSecrets/${groupId}`).catch(() => null);
  if (secret?.data?.inviteHash) {
    try {
      await store.deleteDoc(`groupInvites/${secret.data.inviteHash}`);
    } catch {}
  }
  try {
    await store.deleteDoc(`groupSecrets/${groupId}`);
  } catch {}
  await store.deleteDoc(`groups/${groupId}`);
}
