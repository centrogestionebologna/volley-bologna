import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Ban,
  Check,
  Copy,
  Link2,
  Lock,
  MessageCircle,
  RefreshCw,
  ShieldAlert,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { useAsync, useSubscription } from '../lib/hooks';
import {
  approveMember,
  deleteGroup,
  getGroupSecret,
  joinGroup,
  leaveGroup,
  regenerateInvite,
  rejectMember,
  setGroupBan,
  subscribeGroup,
  subscribeMembers,
  subscribeMembership,
} from '../services/groups';
import { groupChatPath } from '../services/chat';
import { Avatar, Chip, EmptyState, Modal, Spinner } from '../components/ui';
import { ChatRoom } from '../components/ChatRoom';
import { useToast } from '../components/Toast';
import { formatDateShort } from '../lib/format';

export function GroupDetail() {
  const { groupId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { uid, nickname, isAdmin, isBanned, isSilenced, profile } = useAuth();

  const groupState = useSubscription((cb) => subscribeGroup(groupId, cb), [groupId]);
  const membershipState = useSubscription((cb) => subscribeMembership(groupId, uid, cb), [groupId, uid]);
  const membersState = useSubscription((cb) => subscribeMembers(groupId, cb), [groupId]);

  const group = groupState.data ? { id: groupState.data.id, ...groupState.data.data } : null;
  const membership = membershipState.data?.data || null;
  const members = (membersState.data || []).map((row) => ({ id: row.id, ...row.data }));
  const pendingMembers = members.filter((member) => member.status === 'pending');
  const activeMembers = members.filter((member) => member.status === 'active');

  const isOwner = Boolean(group && group.ownerId === uid);
  const isBannedHere = Boolean(group && (group.bannedUids || []).includes(uid));
  const isMember = membership?.status === 'active';
  const isPending = membership?.status === 'pending';

  const [tab, setTab] = useState('chat');
  const [busy, setBusy] = useState('');
  const [code, setCode] = useState('');
  const [showBanModal, setShowBanModal] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const attemptedInvite = useRef(false);

  const secret = useAsync(
    () => (isOwner ? getGroupSecret(groupId) : Promise.resolve(null)),
    [groupId, isOwner]
  );
  const inviteCode = secret.data?.data?.inviteCode || '';

  useEffect(() => {
    const invite = searchParams.get('invite');
    if (!invite || !group || attemptedInvite.current) return;
    if (isMember || isBannedHere) return;
    attemptedInvite.current = true;
    joinGroup({ groupId, user: { uid, nickname }, inviteCode: invite })
      .then((status) => {
        if (status === 'active') toast.success('Sei entrato nel gruppo tramite invito!');
      })
      .catch((error) => toast.error(error.message))
      .finally(() => navigate(`/gruppi/${groupId}`, { replace: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, isMember, searchParams]);

  const join = async (inviteCode = '') => {
    setBusy('join');
    try {
      const status = await joinGroup({ groupId, user: { uid, nickname }, inviteCode });
      if (status === 'pending') toast.success('Richiesta inviata: attendi l’approvazione del fondatore.');
      else toast.success('Benvenuto nel gruppo!');
    } catch (error) {
      toast.error(
        error?.code === 'permission-denied'
          ? 'Codice invito non valido o gruppo non accessibile.'
          : error.message
      );
    } finally {
      setBusy('');
    }
  };

  const leave = async () => {
    if (!window.confirm('Vuoi lasciare il gruppo?')) return;
    setBusy('leave');
    try {
      await leaveGroup({ groupId, uid });
      toast.success('Hai lasciato il gruppo.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  const approve = async (member) => {
    setBusy(`approve-${member.id}`);
    try {
      await approveMember({ groupId, uid: member.id });
      toast.success(`${member.nickname} è entrato nel gruppo.`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  const reject = async (member) => {
    setBusy(`reject-${member.id}`);
    try {
      await rejectMember({ groupId, uid: member.id });
      toast.success('Richiesta rifiutata.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  const ban = async (member) => {
    setBusy(`ban-${member.id}`);
    try {
      await setGroupBan({ groupId, targetUid: member.id, banned: true, actorUid: uid, actorIsAdmin: isAdmin });
      toast.success(`${member.nickname} bannato dal gruppo.`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  const unban = async (targetUid) => {
    setBusy(`unban-${targetUid}`);
    try {
      await setGroupBan({ groupId, targetUid, banned: false, actorUid: uid, actorIsAdmin: isAdmin });
      toast.success('Utente sbloccato.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  const copyInvite = async () => {
    const link = `${window.location.origin}/gruppi/${groupId}?invite=${inviteCode}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link invito copiato.');
    } catch {
      window.prompt('Copia il link invito:', link);
    }
  };

  const regenerate = async () => {
    setBusy('regen');
    try {
      const next = await regenerateInvite(groupId, uid);
      await secret.reload();
      await navigator.clipboard.writeText(`${window.location.origin}/gruppi/${groupId}?invite=${next}`);
      toast.success('Nuovo link generato e copiato.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  const removeGroup = async () => {
    setBusy('delete');
    try {
      await deleteGroup(groupId);
      toast.success('Gruppo eliminato.');
      navigate('/gruppi');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  if (groupState.loading) return <Spinner />;

  if (!group) {
    return (
      <div className="page">
        <EmptyState icon={ShieldAlert} title="Gruppo non trovato" text="Potrebbe essere stato eliminato.">
          <Link to="/gruppi" className="btn btn-ghost">
            Torna ai gruppi
          </Link>
        </EmptyState>
      </div>
    );
  }

  const bannedUsers = (group.bannedUids || [])
    .map((id) => members.find((member) => member.id === id))
    .filter(Boolean);

  const badgeForMembership = isBannedHere
    ? { tone: 'red', label: 'Accesso negato' }
    : isMember
      ? { tone: 'green', label: membership?.role === 'owner' ? 'Fondatore' : 'Membro' }
      : isPending
        ? { tone: 'amber', label: 'In attesa' }
        : { tone: 'muted', label: 'Non iscritto' };

  const canChat = isMember && !isBannedHere && !isBanned && !isSilenced;

  return (
    <div className="page">
      <Link to="/gruppi" className="back-link">
        <ArrowLeft size={15} /> Tutti i gruppi
      </Link>

      <header className="group-header card">
        <div className="group-header-main">
          <span className={`group-icon lg ${group.visibility === 'private' ? 'private' : ''}`}>
            {group.visibility === 'private' ? <Lock size={22} /> : <Users size={22} />}
          </span>
          <div>
            <div className="group-title-row">
              <h1>{group.name}</h1>
              <Chip tone={group.visibility === 'private' ? 'amber' : 'green'}>
                {group.visibility === 'private' ? 'Privato' : 'Pubblico'}
              </Chip>
              <Chip tone={badgeForMembership.tone}>{badgeForMembership.label}</Chip>
            </div>
            <p>{group.description || 'Nessuna descrizione.'}</p>
            <div className="group-meta">
              <span>
                <Users size={14} /> {group.memberCount || 1} membri
              </span>
              <span>Fondato da {group.ownerNickname}</span>
              <span>{formatDateShort(group.createdAt)}</span>
            </div>
          </div>
        </div>
        <div className="group-header-actions">
          {isMember ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={leave} disabled={busy === 'leave'}>
              Esci dal gruppo
            </button>
          ) : isBannedHere ? null : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => join(code)}
              disabled={busy === 'join' || isPending}
            >
              {group.visibility === 'private' ? 'Richiedi accesso' : 'Entra nel gruppo'}
            </button>
          )}
          {isOwner ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleteOpen(true)}>
              <Trash2 size={15} /> Elimina
            </button>
          ) : null}
        </div>
      </header>

      {isBannedHere ? (
        <div className="access-denied big">
          <Lock size={30} />
          <div>
            <h2>Accesso negato</h2>
            <p>
              Sei stato bannato da questo gruppo. Se pensi sia un errore, contatta l’amministrazione
              della community.
            </p>
          </div>
        </div>
      ) : null}

      {!isMember && !isBannedHere ? (
        <div className="card card-pad join-card">
          {isPending ? (
            <>
              <h2>Richiesta in attesa</h2>
              <p className="muted">
                Il fondatore deve approvare la tua richiesta. Nel frattempo puoi consultare la
                descrizione, ma non la chat.
              </p>
            </>
          ) : (
            <>
              <h2>{group.visibility === 'private' ? 'Gruppo privato' : 'Entra nella conversazione'}</h2>
              <p className="muted">
                {group.visibility === 'private'
                  ? 'Serve l’approvazione del fondatore, oppure un link invito diretto.'
                  : 'Il gruppo è pubblico: puoi entrare subito e leggere la chat.'}
              </p>
              <div className="join-actions">
                <button type="button" className="btn btn-primary" onClick={() => join('')} disabled={busy === 'join'}>
                  {group.visibility === 'private' ? 'Richiedi accesso' : 'Entra nel gruppo'}
                </button>
                {group.visibility === 'private' ? (
                  <div className="invite-code-form">
                    <input
                      className="input"
                      placeholder="Codice invito (es. VOLLEY-ABC123)"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                    />
                    <button type="button" className="btn btn-ghost" onClick={() => join(code)} disabled={!code.trim()}>
                      Usa invito
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}

      {isMember && !isBannedHere ? (
        <div className="group-tabs">
          <div className="segmented">
            <button type="button" className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
              <MessageCircle size={15} /> Chat
            </button>
            <button type="button" className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>
              <Users size={15} /> Membri ({activeMembers.length})
              {isOwner && pendingMembers.length ? <span className="tab-dot">{pendingMembers.length}</span> : null}
            </button>
          </div>
        </div>
      ) : null}

      {isMember && !isBannedHere && tab === 'chat' ? (
        <section className="card chat-card">
          <ChatRoom
            path={groupChatPath(groupId)}
            currentUser={{ uid, nickname: profile?.nickname || nickname }}
            canWrite={canChat}
            isModerator={isOwner || isAdmin}
            disabledReason={
              isBanned
                ? 'Il tuo account è sospeso: non puoi scrivere.'
                : isSilenced
                  ? 'Sei in silenzio temporaneo: potrai tornare a scrivere più tardi.'
                  : 'Non puoi scrivere in questa chat.'
            }
          />
        </section>
      ) : null}

      {isMember && !isBannedHere && tab === 'members' ? (
        <div className="detail-grid">
          <section className="card card-pad">
            <div className="section-head">
              <h2>Membri</h2>
              <Chip tone="muted">{activeMembers.length}</Chip>
            </div>
            <ul className="member-list">
              {activeMembers.map((member) => (
                <li key={member.id}>
                  <Avatar name={member.nickname} size="sm" />
                  <div>
                    <strong>
                      {member.nickname} {member.id === uid ? <span className="you-tag">tu</span> : null}
                    </strong>
                    <small>
                      {member.role === 'owner' ? 'Fondatore' : 'Membro'} · dal {formatDateShort(member.joinedAt)}
                    </small>
                  </div>
                  {isOwner && member.id !== uid ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm danger-text"
                      onClick={() => ban(member)}
                      disabled={busy === `ban-${member.id}`}
                    >
                      <Ban size={14} /> Banna
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>

            {isOwner && pendingMembers.length > 0 ? (
              <>
                <div className="section-head sub-head">
                  <h2>Richieste di accesso</h2>
                  <Chip tone="amber">{pendingMembers.length}</Chip>
                </div>
                <ul className="member-list">
                  {pendingMembers.map((member) => (
                    <li key={member.id}>
                      <Avatar name={member.nickname} size="sm" />
                      <div>
                        <strong>{member.nickname}</strong>
                        <small>In attesa dal {formatDateShort(member.joinedAt)}</small>
                      </div>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => approve(member)}
                          disabled={busy === `approve-${member.id}`}
                        >
                          <Check size={14} /> Approva
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => reject(member)}
                          disabled={busy === `reject-${member.id}`}
                        >
                          <X size={14} /> Rifiuta
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {isOwner && bannedUsers.length > 0 ? (
              <>
                <div className="section-head sub-head">
                  <h2>Utenti bannati</h2>
                </div>
                <ul className="member-list">
                  {bannedUsers.map((member) => (
                    <li key={member.id}>
                      <Avatar name={member.nickname} size="sm" />
                      <div>
                        <strong>{member.nickname}</strong>
                        <small>Accesso negato al gruppo</small>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => unban(member.id)}
                        disabled={busy === `unban-${member.id}`}
                      >
                        Sblocca
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          <aside className="detail-side">
            <section className="card card-pad">
              <h2 className="card-title">
                <Link2 size={17} /> Invito
              </h2>
              {group.visibility === 'private' ? (
                isOwner ? (
                  <>
                    <p className="small muted">
                      Chi apre questo link entra direttamente, senza approvazione.
                    </p>
                    <code className="invite-code">{inviteCode || '…'}</code>
                    <div className="row-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={copyInvite}>
                        <Copy size={14} /> Copia link
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={regenerate} disabled={busy === 'regen'}>
                        <RefreshCw size={14} /> Rigenera
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="small muted">
                    Il link invito è gestito dal fondatore. Chiedilo a {group.ownerNickname}.
                  </p>
                )
              ) : (
                <p className="small muted">
                  Questo gruppo è pubblico: chiunque può entrare senza invito.
                </p>
              )}
            </section>

            <section className="card card-pad">
              <h2 className="card-title">
                <UserCheck size={17} /> Regole del gruppo
              </h2>
              <ul className="plain-list">
                <li>Rispetto sempre: niente insulti o discriminazioni.</li>
                <li>La chat è solo testo ed emoji.</li>
                <li>Messaggi conservati per 30 giorni.</li>
                <li>Il fondatore può approvare, rimuovere o bannare.</li>
              </ul>
            </section>
          </aside>
        </div>
      ) : null}

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Eliminare il gruppo?"
        subtitle="L’azione è definitiva. Messaggi e membership non saranno più accessibili."
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleteOpen(false)}>
              Annulla
            </button>
            <button type="button" className="btn btn-danger" onClick={removeGroup} disabled={busy === 'delete'}>
              Elimina gruppo
            </button>
          </>
        }
      >
        <p className="muted">Se vuoi solo chiudere le iscrizioni, non è necessario eliminarlo.</p>
      </Modal>
    </div>
  );
}
