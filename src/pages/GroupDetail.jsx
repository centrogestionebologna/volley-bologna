import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Ban,
  Check,
  ChevronLeft,
  Copy,
  Link2,
  Lock,
  MessageCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { store } from '../backend';
import { VOLLEY_ROLES } from '../config';
import { useAsync, useSubscription } from '../lib/hooks';
import {
  approveMember,
  deleteGroup,
  ensureInviteIndex,
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
import { createPlayerRequest } from '../services/playerRequests';
import { Avatar, Chip, EmptyState, Field, Modal, Spinner } from '../components/ui';
import { ChatRoom } from '../components/ChatRoom';
import { PrivateGroupGate } from '../components/PrivateGroupGate';
import { useToast } from '../components/Toast';
import { formatDateShort, toDate } from '../lib/format';

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
  const infoOpen = searchParams.get('tab') === 'membri';
  const focusRequested =
    searchParams.get('focus') === '1' || searchParams.get('chat') === '1';
  const chatOpen = isMember && !isBannedHere && !infoOpen;

  const [busy, setBusy] = useState('');
  const [inviteBusy, setInviteBusy] = useState(() => Boolean(searchParams.get('invite')));
  const [showBanModal, setShowBanModal] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [playerRequestOpen, setPlayerRequestOpen] = useState(false);
  const [playerRequestForm, setPlayerRequestForm] = useState({
    matchId: '',
    slotsNeeded: 1,
    neededRoles: [],
    note: '',
  });
  const [requestBusy, setRequestBusy] = useState(false);
  const attemptedInvite = useRef(false);

  const myMatchesState = useSubscription(
    (cb) =>
      isOwner && group?.visibility === 'private'
        ? store.subscribeList(
            'matches',
            { where: [['organizerId', '==', uid]], limit: 50 },
            cb
          )
        : () => {},
    [isOwner, uid, group?.visibility]
  );
  const availableMatches = (myMatchesState.data || [])
    .map((row) => ({ id: row.id, ...row.data }))
    .filter((match) => {
      const start = toDate(match.startsAt);
      return (
        match.status === 'open' &&
        start &&
        start.getTime() > Date.now() &&
        (match.confirmedCount || 0) < (match.maxPlayers || 0)
      );
    })
    .sort((a, b) => (toDate(a.startsAt)?.getTime() || 0) - (toDate(b.startsAt)?.getTime() || 0));

  const secret = useAsync(
    () => (isOwner ? getGroupSecret(groupId) : Promise.resolve(null)),
    [groupId, isOwner]
  );
  const inviteCode = secret.data?.data?.inviteCode || '';

  useEffect(() => {
    if (isMember) setInviteBusy(false);
  }, [isMember]);

  useEffect(() => {
    if (!isMember || isBannedHere || infoOpen || focusRequested) return;
    navigate(`/gruppi/${groupId}?focus=1`, { replace: true });
  }, [focusRequested, groupId, infoOpen, isBannedHere, isMember, navigate]);

  useEffect(() => {
    if (!isOwner || !inviteCode) return undefined;
    ensureInviteIndex({ groupId, inviteCode, ownerId: uid }).catch(() => {});
    return undefined;
  }, [groupId, isOwner, inviteCode, uid]);

  useEffect(() => {
    const invite = searchParams.get('invite');
    if (!invite || !group || attemptedInvite.current) return;
    attemptedInvite.current = true;
    setInviteBusy(true);

    if (isBannedHere) {
      setInviteBusy(false);
      navigate(`/gruppi/${groupId}`, { replace: true });
      return;
    }

    if (isMember) {
      setInviteBusy(false);
      navigate(`/gruppi/${groupId}?focus=1`, { replace: true });
      return;
    }

    joinGroup({
      groupId,
      user: { uid, nickname },
      inviteCode: group.visibility === 'private' ? invite : '',
    })
      .then((status) => {
        if (status === 'active') toast.success('Sei entrato nel gruppo tramite invito!');
        navigate(`/gruppi/${groupId}?focus=1`, { replace: true });
      })
      .catch((error) => {
        toast.error(
          error?.code === 'permission-denied'
            ? 'Codice invito non valido o gruppo non accessibile.'
            : error.message
        );
        setInviteBusy(false);
        navigate(`/gruppi/${groupId}`, { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, isMember, isBannedHere, groupId, navigate, searchParams, toast, uid, nickname]);

  const join = async () => {
    setBusy('join');
    try {
      const status = await joinGroup({ groupId, user: { uid, nickname } });
      if (status === 'pending') {
        toast.success('Richiesta inviata: attendi l’approvazione del fondatore.');
      } else {
        toast.success('Benvenuto nel gruppo!');
        navigate(`/gruppi/${groupId}?focus=1`, { replace: true });
      }
    } catch (error) {
      toast.error(
        error?.code === 'permission-denied'
          ? 'Gruppo non accessibile.'
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

  const openPlayerRequest = () => {
    setPlayerRequestForm({
      matchId: availableMatches[0]?.id || '',
      slotsNeeded: 1,
      neededRoles: [],
      note: '',
    });
    setPlayerRequestOpen(true);
  };

  const toggleNeededRole = (role) => {
    setPlayerRequestForm((prev) => ({
      ...prev,
      neededRoles: prev.neededRoles.includes(role)
        ? prev.neededRoles.filter((item) => item !== role)
        : [...prev.neededRoles, role],
    }));
  };

  const submitPlayerRequest = async (event) => {
    event.preventDefault();
    const selectedMatch = availableMatches.find((match) => match.id === playerRequestForm.matchId);
    if (!selectedMatch) {
      toast.error('Scegli un match aperto per cui cercare giocatori.');
      return;
    }
    setRequestBusy(true);
    try {
      const result = await createPlayerRequest({
        group,
        match: selectedMatch,
        organizer: { uid, nickname: profile?.nickname || nickname },
        neededRoles: playerRequestForm.neededRoles,
        slotsNeeded: playerRequestForm.slotsNeeded,
        note: playerRequestForm.note,
      });
      toast.success(
        result.chatPublished
          ? 'Ricerca pubblicata in #generale: il nome del gruppo resta nascosto.'
          : 'Ricerca creata, ma non pubblicata in chat: controlla le regole Firestore.'
      );
      setPlayerRequestOpen(false);
    } catch (error) {
      toast.error(
        error?.code === 'permission-denied'
          ? 'Permessi insufficienti: pubblica le regole Firestore aggiornate.'
          : error.message || 'Ricerca non pubblicata.'
      );
    } finally {
      setRequestBusy(false);
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

  if (groupState.loading || membershipState.loading) return <Spinner />;

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

  if (inviteBusy) return <Spinner label="Apertura invito…" />;

  if (group.visibility === 'private' && !isMember && !isBannedHere) {
    return (
      <div className="page">
        <Link to="/gruppi" className="back-link">
          <ArrowLeft size={15} /> Tutti i gruppi
        </Link>
        <PrivateGroupGate
          title="Gruppo privato"
          subtitle="Inserisci il codice ricevuto da un amico per sbloccare questo gruppo e aprire la chat."
          pending={isPending}
          onUnlocked={(unlockedId) => navigate(`/gruppi/${unlockedId}?focus=1`, { replace: true })}
        />
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

  if (chatOpen) {
    return (
      <div className="page chat-page chat-page--full">
        <section className="card chat-card chat-card--full">
          <header className="chat-head chat-head--compact">
            <Link to="/gruppi" className="chat-head-back" aria-label="Torna ai gruppi e scegli un'altra chat">
              <ChevronLeft size={22} />
            </Link>
            <span className={`group-icon ${group.visibility === 'private' ? 'private' : ''}`}>
              {group.visibility === 'private' ? <Lock size={19} /> : <Users size={19} />}
            </span>
            <div className="chat-head-title">
              <Link
                to={`/gruppi/${groupId}?tab=membri`}
                className="chat-head-name"
                title="Apri la descrizione del gruppo"
              >
                {group.name}
              </Link>
            </div>
          </header>
          <ChatRoom
            path={groupChatPath(groupId)}
            currentUser={{ uid, nickname: profile?.nickname || nickname }}
            canWrite={canChat}
            isModerator={isOwner || isAdmin}
            composerLabel={group.name}
            disabledReason={
              isBanned
                ? 'Il tuo account è sospeso: non puoi scrivere.'
                : isSilenced
                  ? 'Sei in silenzio temporaneo: potrai tornare a scrivere più tardi.'
                  : 'Non puoi scrivere in questa chat.'
            }
          />
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      {isMember ? (
        <Link to={`/gruppi/${groupId}?focus=1`} className="back-link">
          <ArrowLeft size={15} /> Torna alla chat
        </Link>
      ) : (
        <Link to="/gruppi" className="back-link">
          <ArrowLeft size={15} /> Tutti i gruppi
        </Link>
      )}

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
              className="btn btn-whatsapp btn-sm"
              onClick={join}
              disabled={busy === 'join' || isPending}
            >
              <MessageCircle size={15} />
              {isPending ? 'Richiesta in attesa' : 'Entra nel gruppo'}
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

      {!isMember && !isBannedHere && group.visibility !== 'private' ? (
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
              <h2>Entra nella conversazione</h2>
              <p className="muted">
                Il gruppo è pubblico: puoi entrare subito e leggere la chat. La conversazione
                comparirà solo dopo l’ingresso.
              </p>
              <div className="join-actions">
                <button
                  type="button"
                  className="btn btn-whatsapp"
                  onClick={join}
                  disabled={busy === 'join'}
                >
                  <MessageCircle size={18} /> Entra nel gruppo
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {isMember && !isBannedHere && infoOpen ? (
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
            {isOwner && group.visibility === 'private' ? (
              <section className="card card-pad player-search-card">
                <h2 className="card-title">
                  <UserPlus size={17} /> Cerca giocatori
                </h2>
                <p className="small muted">
                  Pubblica in #generale solo data, palestra e ruoli mancanti. Il nome del gruppo e
                  il link al match non compaiono nella chat.
                </p>
                <button
                  type="button"
                  className="btn btn-primary btn-block btn-sm"
                  onClick={openPlayerRequest}
                  disabled={availableMatches.length === 0}
                >
                  <Search size={15} /> Nuova ricerca
                </button>
                {availableMatches.length === 0 ? (
                  <p className="hint">
                    Ti serve un match aperto con posti liberi.{' '}
                    <Link to="/match/nuovo">Organizzane uno</Link>.
                  </p>
                ) : (
                  <p className="hint">
                    Le candidature arrivano qui: le approvi dalla card in #generale.
                  </p>
                )}
              </section>
            ) : null}

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

      <Modal
        open={playerRequestOpen}
        onClose={() => setPlayerRequestOpen(false)}
        title="Cerca giocatori"
        subtitle="La chat generale mostrerà “Ricerca giocatori da gruppo privato”: nome del gruppo e link al match restano riservati."
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setPlayerRequestOpen(false)}>
              Annulla
            </button>
            <button
              type="submit"
              form="player-request-form"
              className="btn btn-primary"
              disabled={requestBusy || !playerRequestForm.matchId}
            >
              <UserPlus size={16} /> {requestBusy ? 'Pubblicazione…' : 'Pubblica ricerca'}
            </button>
          </>
        }
      >
        <form id="player-request-form" className="form" onSubmit={submitPlayerRequest}>
          <Field label="Match per cui cerchi giocatori *">
            <select
              className="select"
              value={playerRequestForm.matchId}
              onChange={(event) =>
                setPlayerRequestForm((prev) => ({ ...prev, matchId: event.target.value }))
              }
              required
            >
              <option value="">Scegli un match…</option>
              {availableMatches.map((match) => (
                <option key={match.id} value={match.id}>
                  {formatDateShort(match.startsAt)} · {match.time} · {match.gym}
                </option>
              ))}
            </select>
          </Field>
          {availableMatches.length === 0 ? (
            <p className="hint">
              Non hai match aperti con posti liberi. <Link to="/match/nuovo">Organizza un match</Link>.
            </p>
          ) : null}

          <div className="form-row">
            <Field label="Giocatori mancanti">
              <input
                className="input"
                type="number"
                min="1"
                max="8"
                value={playerRequestForm.slotsNeeded}
                onChange={(event) =>
                  setPlayerRequestForm((prev) => ({ ...prev, slotsNeeded: event.target.value }))
                }
              />
            </Field>
            <div className="field">
              <span className="field-label">Ruoli cercati</span>
              <div className="role-checks">
                {VOLLEY_ROLES.map((role) => (
                  <label key={role.value} className="check">
                    <input
                      type="checkbox"
                      checked={playerRequestForm.neededRoles.includes(role.value)}
                      onChange={() => toggleNeededRole(role.value)}
                    />
                    <span>{role.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <Field
            label="Nota pubblica"
            hint="Massimo 400 caratteri. Non inserire nome del gruppo, contatti o dati personali."
          >
            <textarea
              className="textarea"
              rows={3}
              maxLength={400}
              value={playerRequestForm.note}
              onChange={(event) =>
                setPlayerRequestForm((prev) => ({ ...prev, note: event.target.value }))
              }
              placeholder="Es. cerchiamo un centrale per una partita amichevole, livello intermedio…"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
