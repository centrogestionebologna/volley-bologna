import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Ban,
  BarChart3,
  CalendarPlus,
  Check,
  ChevronLeft,
  Copy,
  Link2,
  Lock,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { store } from '../backend';
import {
  GROUP_SETTING_OPTIONS,
  PROFILE_REQUIREMENTS,
  VOLLEY_ROLES,
  labelOf,
  normalizeGroupSettings,
  retentionDaysForSetting,
} from '../config';
import { useAsync, useSubscription } from '../lib/hooks';
import {
  approveMember,
  deleteGroup,
  ensureInviteIndex,
  getGroupSecret,
  joinGroup,
  leaveGroup,
  loadProfileChecks,
  missingProfileLabels,
  regenerateInvite,
  rejectMember,
  setGroupBan,
  updateGroupDetails,
  subscribeGroup,
  subscribeMembers,
  subscribeMembership,
} from '../services/groups';
import { groupChatPath } from '../services/chat';
import {
  closePoll,
  createPoll,
  deletePoll,
  subscribePollVotes,
  subscribePolls,
  tallyVotes,
  votePoll,
} from '../services/polls';
import { createPlayerRequest } from '../services/playerRequests';
import { Avatar, Chip, EmptyState, Field, Modal, Spinner } from '../components/ui';
import { ChatRoom } from '../components/ChatRoom';
import { useChatComposerDock } from '../components/ChatComposerDock';
import { PrivateGroupGate } from '../components/PrivateGroupGate';
import { useToast } from '../components/Toast';
import { formatDateShort, toDate } from '../lib/format';

function PollCard({ groupId, poll, uid, canManage, busy, onVote, onClose, onDelete }) {
  const votesState = useSubscription(
    (cb) => subscribePollVotes(groupId, poll.id, cb),
    [groupId, poll.id]
  );
  const votes = (votesState.data || []).map((row) => ({ id: row.id, ...row.data }));
  const options = poll.options || [];
  const counts = tallyVotes(votes, options.length);
  const total = counts.reduce((sum, value) => sum + value, 0);
  const myVote = votes.find((vote) => vote.uid === uid);
  const closed = poll.status === 'closed';

  return (
    <article className="poll-card">
      <div className="poll-head">
        <strong>{poll.question}</strong>
        <Chip tone={closed ? 'muted' : 'green'}>
          {closed ? 'Chiuso' : `${total} ${total === 1 ? 'voto' : 'voti'}`}
        </Chip>
      </div>
      <div className="poll-options">
        {options.map((option, index) => {
          const count = counts[index] || 0;
          const percent = total ? Math.round((count / total) * 100) : 0;
          const selected = myVote?.optionIndex === index;
          return (
            <button
              key={`${poll.id}-${index}`}
              type="button"
              className={`poll-option ${selected ? 'selected' : ''}`}
              onClick={() => onVote(poll, index)}
              disabled={closed || busy === `vote-${poll.id}`}
            >
              <span className="poll-option-bar" style={{ width: `${percent}%` }} aria-hidden />
              <span className="poll-option-label">{option}</span>
              <span className="poll-option-count">{count} · {percent}%</span>
            </button>
          );
        })}
      </div>
      <div className="poll-foot">
        <small className="muted">
          {poll.createdByName || 'Membro'} · {formatDateShort(poll.createdAt)}
          {selectedLabelSuffix(myVote, options)}
        </small>
        {canManage ? (
          <div className="row-actions">
            {closed ? null : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onClose(poll)}
                disabled={busy === `close-${poll.id}`}
              >
                Chiudi
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm danger-text"
              onClick={() => onDelete(poll)}
              disabled={busy === `delete-${poll.id}`}
            >
              <Trash2 size={14} /> Elimina
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function profileSummary(required = [], checks = null) {
  if (!checks) return '';
  const missing = missingProfileLabels(required, checks);
  return missing.length ? ` · manca: ${missing.join(', ').toLowerCase()}` : ' · profilo completo';
}

function selectedLabelSuffix(vote, options) {
  if (!vote) return '';
  const index = Number(vote.optionIndex);
  return options[index] ? ' · hai votato' : '';
}

export function GroupDetail() {
  const { groupId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { uid, nickname, isAdmin, isBanned, isSilenced, profile } = useAuth();
  const { wheelOpen, setWheelOpen } = useChatComposerDock();

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
  // Ospite temporaneo: aggiunto alla chat dopo l'approvazione di una ricerca
  // giocatori. Vede solo la chat, mai descrizione e codici invito.
  const isGuest = Boolean(isMember && membership?.role === 'guest');
  const guestUntil = toDate(membership?.guestUntil);
  const baseNickname = profile?.nickname || nickname;
  const chatNickname = isGuest ? `${baseNickname} (guest)` : baseNickname;
  const groupSettings = normalizeGroupSettings(group);
  const canManageSettings = Boolean(group && (isOwner || isAdmin));
  const canEditGroup = Boolean(
    group && (canManageSettings || (isMember && !isGuest && groupSettings.editInfoPolicy === 'all'))
  );
  const canReadInvite = Boolean(
    group && (canManageSettings || (isMember && !isGuest && groupSettings.addMembersPolicy === 'all'))
  );
  const infoOpen = searchParams.get('tab') === 'membri';
  const focusRequested =
    searchParams.get('focus') === '1' || searchParams.get('chat') === '1';
  const chatOpen = isMember && !isBannedHere && !infoOpen;
  const canOrganizeMatch = Boolean(
    isMember &&
      !isGuest &&
      (groupSettings.matchOrganizersPolicy !== 'admins' || isOwner || isAdmin)
  );
  const canSearchPlayers = Boolean(isMember && !isGuest);

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [pollsOpen, setPollsOpen] = useState(false);
  const [pollBusy, setPollBusy] = useState('');
  const [pollForm, setPollForm] = useState({ question: '', options: ['', ''] });
  const attemptedInvite = useRef(false);

  // Selettore gruppi e menu del "+" non devono mai sovrapporsi.
  useEffect(() => {
    if (wheelOpen) setActionsOpen(false);
  }, [wheelOpen]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('group-actions-open', actionsOpen);
    return () => root.classList.remove('group-actions-open');
  }, [actionsOpen]);

  const myMatchesState = useSubscription(
    (cb) =>
      isMember && !isGuest && uid
        ? store.subscribeList(
            'matches',
            { where: [['organizerId', '==', uid]], limit: 50 },
            cb
          )
        : () => {},
    [isMember, isGuest, uid]
  );
  const pollsState = useSubscription(
    (cb) => (pollsOpen ? subscribePolls(groupId, cb) : () => {}),
    [groupId, pollsOpen]
  );
  const polls = (pollsState.data || []).map((row) => ({ id: row.id, ...row.data }));

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

  const profileChecksState = useAsync(
    () => (uid ? loadProfileChecks(uid) : Promise.resolve(null)),
    [uid]
  );
  const missingRequirements = missingProfileLabels(
    groupSettings.requiredProfileFields,
    profileChecksState.data || {}
  );

  const secret = useAsync(
    () => (canReadInvite ? getGroupSecret(groupId) : Promise.resolve(null)),
    [groupId, canReadInvite]
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
        setInviteBusy(false);
        if (status === 'active') toast.success('Sei entrato nel gruppo tramite invito!');
        else toast.success('Richiesta inviata: attendi l’approvazione del fondatore.');
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
    if (missingRequirements.length) {
      toast.error(
        `Completa prima il profilo: manca ${missingRequirements.join(', ').toLowerCase()}.`
      );
      return;
    }
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

  const openSettings = () => {
    setSettingsForm({
      name: group.name || '',
      description: group.description || '',
      ...groupSettings,
    });
    setSettingsOpen(true);
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    if (!settingsForm) return;
    setSettingsBusy(true);
    try {
      await updateGroupDetails({
        groupId,
        name: settingsForm.name,
        description: settingsForm.description,
        icon: settingsForm.icon,
        settings: settingsForm,
        actorUid: uid,
        actorIsAdmin: isAdmin,
        actorIsMember: isMember,
      });
      toast.success(
        canManageSettings ? 'Impostazioni aggiornate.' : 'Nome, icona e descrizione aggiornati.'
      );
      setSettingsOpen(false);
    } catch (error) {
      toast.error(
        error?.code === 'permission-denied'
          ? 'Permessi insufficienti: pubblica le regole Firestore aggiornate.'
          : error.message
      );
    } finally {
      setSettingsBusy(false);
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

  const submitPoll = async (event) => {
    event.preventDefault();
    setPollBusy('create');
    try {
      await createPoll({
        groupId,
        user: { uid, nickname: profile?.nickname || nickname },
        question: pollForm.question,
        options: pollForm.options,
      });
      setPollForm({ question: '', options: ['', ''] });
      toast.success('Sondaggio pubblicato.');
    } catch (error) {
      toast.error(error.message || 'Sondaggio non pubblicato.');
    } finally {
      setPollBusy('');
    }
  };

  const vote = async (poll, optionIndex) => {
    setPollBusy(`vote-${poll.id}`);
    try {
      await votePoll({ groupId, pollId: poll.id, uid, optionIndex });
    } catch (error) {
      toast.error(error.message || 'Voto non registrato.');
    } finally {
      setPollBusy('');
    }
  };

  const closePollAction = async (poll) => {
    setPollBusy(`close-${poll.id}`);
    try {
      await closePoll({ groupId, pollId: poll.id });
      toast.success('Sondaggio chiuso.');
    } catch (error) {
      toast.error(error.message || 'Sondaggio non chiuso.');
    } finally {
      setPollBusy('');
    }
  };

  const removePoll = async (poll) => {
    if (!window.confirm('Eliminare questo sondaggio?')) return;
    setPollBusy(`delete-${poll.id}`);
    try {
      await deletePoll({ groupId, pollId: poll.id });
      toast.success('Sondaggio eliminato.');
    } catch (error) {
      toast.error(error.message || 'Sondaggio non eliminato.');
    } finally {
      setPollBusy('');
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
      ? {
          tone: 'green',
          label:
            membership?.role === 'owner'
              ? 'Fondatore'
              : membership?.role === 'guest'
                ? 'Ospite'
                : 'Membro',
        }
      : isPending
        ? { tone: 'amber', label: 'In attesa' }
        : { tone: 'muted', label: 'Non iscritto' };

  const canChat =
    isMember &&
    !isBannedHere &&
    !isBanned &&
    !isSilenced &&
    (groupSettings.sendMessagesPolicy === 'all' || isOwner || isAdmin);

  // Questi pannelli servono anche dentro la chat (menu del "+"), che ha un
  // return anticipato: vanno definiti prima, altrimenti non si aprono.
  const overlays = (
    <>
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
      <Modal
        open={pollsOpen}
        onClose={() => setPollsOpen(false)}
        title="Sondaggi del gruppo"
        subtitle="Un voto per persona: puoi cambiare scelta finché il sondaggio è aperto."
        footer={
          <button type="button" className="btn btn-ghost" onClick={() => setPollsOpen(false)}>
            Chiudi
          </button>
        }
      >
        <form className="form poll-create" onSubmit={submitPoll}>
          <Field label="Nuovo sondaggio" hint="La domanda e le opzioni sono visibili a tutti i membri.">
            <input
              className="input"
              value={pollForm.question}
              onChange={(event) =>
                setPollForm((prev) => ({ ...prev, question: event.target.value }))
              }
              placeholder="Es. a che ora giochiamo mercoledì?"
              maxLength={200}
            />
          </Field>
          {pollForm.options.map((option, index) => (
            <input
              key={`poll-option-${index}`}
              className="input"
              value={option}
              onChange={(event) =>
                setPollForm((prev) => ({
                  ...prev,
                  options: prev.options.map((item, i) =>
                    i === index ? event.target.value : item
                  ),
                }))
              }
              placeholder={`Opzione ${index + 1}`}
              maxLength={80}
            />
          ))}
          <div className="row-actions">
            {pollForm.options.length < 8 ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setPollForm((prev) => ({ ...prev, options: [...prev.options, ''] }))
                }
              >
                <Plus size={14} /> Aggiungi opzione
              </button>
            ) : null}
            <button type="submit" className="btn btn-primary btn-sm" disabled={pollBusy === 'create'}>
              {pollBusy === 'create' ? 'Pubblicazione…' : 'Pubblica sondaggio'}
            </button>
          </div>
        </form>

        <div className="poll-list">
          {polls.length === 0 ? (
            <p className="muted small">Nessun sondaggio ancora: creane uno qui sopra.</p>
          ) : (
            polls.map((poll) => (
              <PollCard
                key={poll.id}
                groupId={groupId}
                poll={poll}
                uid={uid}
                canManage={poll.createdBy === uid || isOwner || isAdmin}
                busy={pollBusy}
                onVote={vote}
                onClose={closePollAction}
                onDelete={removePoll}
              />
            ))
          )}
        </div>
      </Modal>
    </>
  );

  if (chatOpen) {
    return (
      <div className="page chat-page chat-page--full">
        <section className="card chat-card chat-card--full">
          <header className="chat-head chat-head--compact">
            <Link to="/gruppi" className="chat-head-back" aria-label="Torna ai gruppi e scegli un'altra chat">
              <ChevronLeft size={22} />
            </Link>
            <span className={`group-icon ${group.visibility === 'private' ? 'private' : ''} ${group.icon ? 'emoji' : ''}`}>
              {group.icon || (group.visibility === 'private' ? <Lock size={19} /> : <Users size={19} />)}
            </span>
            <div className="chat-head-title">
              <Link
                to={`/gruppi/${groupId}?tab=membri`}
                className="chat-head-name"
                title={isGuest ? 'Membri del gruppo' : 'Apri la descrizione del gruppo'}
              >
                {group.name}
              </Link>
              {isGuest ? <Chip tone="amber">Ospite</Chip> : null}
            </div>
          </header>
          <ChatRoom
            path={groupChatPath(groupId)}
            currentUser={{ uid, nickname: chatNickname }}
            visibleFrom={isGuest ? toDate(membership?.joinedAt) : null}
            canWrite={canChat}
            isModerator={isOwner || isAdmin}
            canClearChat={isAdmin}
            composerLabel={group.name}
            retentionDays={retentionDaysForSetting(groupSettings.disappearingMessages)}
            disabledReason={
              isBanned
                ? 'Il tuo account è sospeso: non puoi scrivere.'
                : isSilenced
                  ? 'Sei in silenzio temporaneo: potrai tornare a scrivere più tardi.'
                  : 'Non puoi scrivere in questa chat.'
            }
          />
        </section>

        {isMember && !isGuest && !isBannedHere && !wheelOpen ? (
          <div className={`chat-actions ${actionsOpen ? 'open' : ''}`}>
            {actionsOpen ? (
              <>
                <button
                  type="button"
                  className="chat-actions-backdrop"
                  aria-label="Chiudi il menu azioni"
                  onClick={() => setActionsOpen(false)}
                />
                <div className="chat-actions-menu" role="menu">
                  {canOrganizeMatch ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setActionsOpen(false);
                        navigate(`/match/nuovo?groupId=${groupId}`);
                      }}
                    >
                      <CalendarPlus size={16} /> Proponi un match
                    </button>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActionsOpen(false);
                      setPollsOpen(true);
                    }}
                  >
                    <BarChart3 size={16} /> Sondaggi del gruppo
                  </button>
                  {canSearchPlayers && availableMatches.length > 0 ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setActionsOpen(false);
                        openPlayerRequest();
                      }}
                    >
                      <UserPlus size={16} /> Cerca giocatori in #generale
                    </button>
                  ) : null}
                  {canReadInvite && inviteCode ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setActionsOpen(false);
                        copyInvite();
                      }}
                    >
                      <Link2 size={16} /> Copia link invito
                    </button>
                  ) : null}
                  {canOrganizeMatch ? null : (
                    <p className="chat-actions-note">
                      Solo fondatore e admin possono organizzare i match in questo gruppo.
                    </p>
                  )}
                </div>
              </>
            ) : null}
            <button
              type="button"
              className={`chat-actions-toggle ${actionsOpen ? 'active' : ''}`}
              onClick={() => {
                setWheelOpen(false);
                setActionsOpen((open) => !open);
              }}
              aria-label="Azioni del gruppo"
              aria-expanded={actionsOpen}
              title="Azioni del gruppo"
            >
              {actionsOpen ? <X size={20} /> : <Plus size={20} />}
            </button>
          </div>
        ) : null}
        {overlays}
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
          <span className={`group-icon lg ${group.visibility === 'private' ? 'private' : ''} ${group.icon ? 'emoji' : ''}`}>
            {group.icon || (group.visibility === 'private' ? <Lock size={22} /> : <Users size={22} />)}
          </span>
          <div>
            <div className="group-title-row">
              <h1>{group.name}</h1>
              <Chip tone={group.visibility === 'private' ? 'amber' : 'green'}>
                {group.visibility === 'private' ? 'Privato' : 'Pubblico'}
              </Chip>
              <Chip tone={badgeForMembership.tone}>{badgeForMembership.label}</Chip>
            </div>
            <p>
              {isGuest
                ? 'Descrizione riservata: come ospite vedi solo la chat del gruppo.'
                : group.description || 'Nessuna descrizione.'}
            </p>
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

      {isGuest ? (
        <div className="banner banner-warn">
          <ShieldAlert size={18} />
          <div>
            <strong>Accesso ospite</strong>
            <span>
              Sei nella chat di questo gruppo come ospite
              {guestUntil ? ` fino al ${formatDateShort(guestUntil)}` : ''}: descrizione e codici
              invito restano riservati ai membri.
            </span>
          </div>
        </div>
      ) : null}

      {!isBannedHere && !isGuest ? (
        <section className="card card-pad group-settings">
          <div className="section-head">
            <h2>
              <Settings size={18} /> Impostazioni gruppo
            </h2>
            {canEditGroup ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={openSettings}>
                <Pencil size={14} /> Modifica
              </button>
            ) : null}
          </div>
          <div className="group-settings-grid">
            <div className="group-setting">
              <span>Icona</span>
              <strong>{groupSettings.icon || 'Predefinita'}</strong>
            </div>
            <div className="group-setting">
              <span>Chi può scrivere</span>
              <strong>{labelOf(GROUP_SETTING_OPTIONS.sendMessagesPolicy, groupSettings.sendMessagesPolicy)}</strong>
            </div>
            <div className="group-setting">
              <span>Chi può modificare le info</span>
              <strong>{labelOf(GROUP_SETTING_OPTIONS.editInfoPolicy, groupSettings.editInfoPolicy)}</strong>
            </div>
            <div className="group-setting">
              <span>Chi può aggiungere membri</span>
              <strong>{labelOf(GROUP_SETTING_OPTIONS.addMembersPolicy, groupSettings.addMembersPolicy)}</strong>
            </div>
            <div className="group-setting">
              <span>Chi può organizzare i match</span>
              <strong>
                {labelOf(
                  GROUP_SETTING_OPTIONS.matchOrganizersPolicy,
                  groupSettings.matchOrganizersPolicy
                )}
              </strong>
            </div>
            <div className="group-setting">
              <span>Requisiti per entrare</span>
              <strong>
                {groupSettings.requiredProfileFields.length
                  ? groupSettings.requiredProfileFields
                      .map((value) => labelOf(PROFILE_REQUIREMENTS, value))
                      .join(', ')
                  : 'Nessuno'}
              </strong>
            </div>
            <div className="group-setting">
              <span>Approvazione nuovi membri</span>
              <strong>
                {group.visibility === 'private'
                  ? groupSettings.approveNewMembers
                    ? 'Richiesta'
                    : 'Automatica'
                  : 'Non necessaria'}
              </strong>
            </div>
            <div className="group-setting">
              <span>Messaggi effimeri</span>
              <strong>{labelOf(GROUP_SETTING_OPTIONS.disappearingMessages, groupSettings.disappearingMessages)}</strong>
            </div>
            <div className="group-setting">
              <span>Conservazione chat</span>
              <strong>{retentionDaysForSetting(groupSettings.disappearingMessages)} giorni</strong>
            </div>
            <div className="group-setting">
              <span>Allegati</span>
              <strong>Solo testo ed emoji</strong>
            </div>
            <div className="group-setting">
              <span>Invito</span>
              <strong>{group.visibility === 'private' ? 'Codice o link' : 'Accesso pubblico'}</strong>
            </div>
          </div>
        </section>
      ) : null}

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
              {groupSettings.requiredProfileFields.length ? (
                <p className={missingRequirements.length ? 'hint danger-text' : 'hint'}>
                  {missingRequirements.length
                    ? `Per entrare serve: ${missingRequirements.join(', ').toLowerCase()}. `
                    : 'Requisiti del profilo soddisfatti. '}
                  {missingRequirements.length ? (
                    <Link to="/profilo">Completa il profilo</Link>
                  ) : null}
                </p>
              ) : null}
              <div className="join-actions">
                <button
                  type="button"
                  className="btn btn-whatsapp"
                  onClick={join}
                  disabled={busy === 'join' || missingRequirements.length > 0}
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
                      {member.role === 'owner'
                        ? 'Fondatore'
                        : member.role === 'guest'
                          ? 'Ospite temporaneo'
                          : 'Membro'}{' '}
                      · dal {formatDateShort(member.joinedAt)}
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
                        <small>
                          In attesa dal {formatDateShort(member.joinedAt)}
                          {profileSummary(groupSettings.requiredProfileFields, member.profileChecks)}
                        </small>
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
            {isMember && !isGuest ? (
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
              {isGuest ? (
                <p className="small muted">
                  Come ospite temporaneo non puoi vedere il codice invito del gruppo.
                </p>
              ) : group.visibility === 'private' ? (
                canReadInvite ? (
                  <>
                    <p className="small muted">
                      {groupSettings.approveNewMembers
                        ? 'Chi apre questo link deve essere approvato dal fondatore.'
                        : 'Chi apre questo link entra direttamente, senza approvazione.'}
                    </p>
                    <code className="invite-code">{inviteCode || '…'}</code>
                    <div className="row-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={copyInvite}>
                        <Copy size={14} /> Copia link
                      </button>
                      {isOwner ? (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={regenerate} disabled={busy === 'regen'}>
                          <RefreshCw size={14} /> Rigenera
                        </button>
                      ) : null}
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
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Impostazioni gruppo"
        subtitle="Nome, icona, descrizione e regole della chat. Le modifiche sono immediate per tutti i membri."
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setSettingsOpen(false)}>
              Annulla
            </button>
            <button
              type="submit"
              form="group-settings-form"
              className="btn btn-primary"
              disabled={settingsBusy || !settingsForm}
            >
              {settingsBusy ? 'Salvataggio…' : 'Salva'}
            </button>
          </>
        }
      >
        {settingsForm ? (
          <form id="group-settings-form" className="form" onSubmit={saveSettings}>
            <Field label="Nome del gruppo *">
              <input
                className="input"
                value={settingsForm.name}
                onChange={(event) =>
                  setSettingsForm((prev) => ({ ...prev, name: event.target.value }))
                }
                required
                minLength={3}
                maxLength={80}
              />
            </Field>
            <Field label="Descrizione" hint="Massimo 400 caratteri.">
              <textarea
                className="textarea"
                rows={3}
                value={settingsForm.description}
                onChange={(event) =>
                  setSettingsForm((prev) => ({ ...prev, description: event.target.value }))
                }
                maxLength={400}
              />
            </Field>
            <Field label="Icona" hint="Usa un’emoji, ad esempio 🏐.">
              <input
                className="input group-icon-input"
                value={settingsForm.icon}
                onChange={(event) =>
                  setSettingsForm((prev) => ({ ...prev, icon: event.target.value }))
                }
                maxLength={8}
                placeholder="🏐"
              />
            </Field>

            {canManageSettings ? (
              <>
                <div className="form-row">
                  <Field label="Chi può scrivere">
                    <select
                      className="select"
                      value={settingsForm.sendMessagesPolicy}
                      onChange={(event) =>
                        setSettingsForm((prev) => ({
                          ...prev,
                          sendMessagesPolicy: event.target.value,
                        }))
                      }
                    >
                      {GROUP_SETTING_OPTIONS.sendMessagesPolicy.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Chi può modificare le info">
                    <select
                      className="select"
                      value={settingsForm.editInfoPolicy}
                      onChange={(event) =>
                        setSettingsForm((prev) => ({
                          ...prev,
                          editInfoPolicy: event.target.value,
                        }))
                      }
                    >
                      {GROUP_SETTING_OPTIONS.editInfoPolicy.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="form-row">
                  <Field label="Chi può aggiungere membri">
                    <select
                      className="select"
                      value={settingsForm.addMembersPolicy}
                      onChange={(event) =>
                        setSettingsForm((prev) => ({
                          ...prev,
                          addMembersPolicy: event.target.value,
                        }))
                      }
                    >
                      {GROUP_SETTING_OPTIONS.addMembersPolicy.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </Field>
                  <div className="field">
                    <span className="field-label">Approvazione nuovi membri</span>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={settingsForm.approveNewMembers}
                        onChange={(event) =>
                          setSettingsForm((prev) => ({
                            ...prev,
                            approveNewMembers: event.target.checked,
                          }))
                        }
                      />
                      <span>Richiedi approvazione</span>
                    </label>
                    <span className="field-hint">
                      Per i gruppi privati vale anche per chi entra dal link invito.
                    </span>
                  </div>
                </div>

                <Field
                  label="Messaggi effimeri"
                  hint="La manutenzione elimina i messaggi più vecchi del periodo scelto."
                >
                  <select
                    className="select"
                    value={settingsForm.disappearingMessages}
                    onChange={(event) =>
                      setSettingsForm((prev) => ({
                        ...prev,
                        disappearingMessages: event.target.value,
                      }))
                    }
                  >
                    {GROUP_SETTING_OPTIONS.disappearingMessages.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </Field>

                <Field
                  label="Chi può organizzare i match"
                  hint="Con “Solo fondatore e admin” gli altri membri non vedono l’azione per proporre un match."
                >
                  <select
                    className="select"
                    value={settingsForm.matchOrganizersPolicy}
                    onChange={(event) =>
                      setSettingsForm((prev) => ({
                        ...prev,
                        matchOrganizersPolicy: event.target.value,
                      }))
                    }
                  >
                    {GROUP_SETTING_OPTIONS.matchOrganizersPolicy.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </Field>

                <div className="field">
                  <span className="field-label">Requisiti per entrare</span>
                  <div className="role-checks">
                    {PROFILE_REQUIREMENTS.map((requirement) => (
                      <label key={requirement.value} className="check">
                        <input
                          type="checkbox"
                          checked={settingsForm.requiredProfileFields.includes(requirement.value)}
                          onChange={(event) =>
                            setSettingsForm((prev) => ({
                              ...prev,
                              requiredProfileFields: event.target.checked
                                ? [...new Set([...prev.requiredProfileFields, requirement.value])]
                                : prev.requiredProfileFields.filter(
                                    (value) => value !== requirement.value
                                  ),
                            }))
                          }
                        />
                        <span>{requirement.label}</span>
                      </label>
                    ))}
                  </div>
                  <span className="field-hint">
                    Chi non ha questi dati non può chiedere di entrare. Il gruppo vede solo se ci
                    sono, non i valori.
                  </span>
                </div>
              </>
            ) : (
              <p className="hint">
                Puoi modificare nome, icona e descrizione. Le altre impostazioni sono gestite dal
                fondatore o da un amministratore.
              </p>
            )}
          </form>
        ) : null}
      </Modal>


      {overlays}
    </div>
  );
}
