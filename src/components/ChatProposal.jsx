import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock,
  Euro,
  Loader2,
  Lock,
  MapPin,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { AGE_BANDS, LEVELS, VOLLEY_ROLES, labelOf } from '../config';
import { store } from '../backend';
import { useSubscription } from '../lib/hooks';
import { formatDateShort, formatEuros, toDate } from '../lib/format';
import { Chip, Field, Modal } from './ui';
import { useToast } from './Toast';
import {
  applyToPlayerRequest,
  approveApplication,
  rejectApplication,
  subscribeApplications,
  subscribeMyApplication,
  subscribePlayerRequest,
} from '../services/playerRequests';

function roleLabels(values = []) {
  return values.map((value) => labelOf(VOLLEY_ROLES, value)).filter(Boolean);
}

function formatMatchWhen(summary = {}) {
  const date = toDate(summary.startsAt);
  if (!date) return summary.time || 'Data da definire';
  return `${formatDateShort(date)} · ${summary.time || date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
}

export function MatchProposalCard({ message }) {
  const match = message.match || {};
  const confirmed = Number(match.confirmedCount) || 0;
  const maxPlayers = Number(match.maxPlayers) || 0;
  const full = maxPlayers > 0 && confirmed >= maxPlayers;

  return (
    <article className="chat-proposal">
      <div className="chat-proposal-head">
        <span className="chat-proposal-icon">
          <CalendarDays size={18} />
        </span>
        <div>
          <strong>Proposta di match</strong>
          <small>{match.organizerNickname ? `di ${match.organizerNickname}` : 'Match aperto'}</small>
        </div>
      </div>

      <div className="chat-proposal-body">
        <h3>{match.title || 'Nuovo match'}</h3>
        <div className="chat-proposal-meta">
          <span>
            <CalendarDays size={13} /> {formatMatchWhen(match)}
          </span>
          <span>
            <MapPin size={13} /> {match.gym || 'Palestra da definire'}
            {match.zone ? ` · ${match.zone}` : ''}
          </span>
          <span>
            <Users size={13} /> {confirmed}/{maxPlayers || '—'} iscritti
          </span>
          <span>
            <Euro size={13} /> {formatEuros(match.cost)}
          </span>
        </div>
        <div className="chat-proposal-tags">
          <Chip tone="blue">{labelOf(LEVELS, match.level)}</Chip>
          <Chip tone="violet">{labelOf(AGE_BANDS, match.ageBand)}</Chip>
          {full ? <Chip tone="amber">Pieno · entra in riserva</Chip> : <Chip tone="green">Posti liberi</Chip>}
        </div>
      </div>

      <Link
        to={`/match/${message.matchId}`}
        className="chat-proposal-action"
        onClick={(event) => event.stopPropagation()}
      >
        <span>{full ? 'Apri e entra in riserva' : 'Apri e iscriviti'}</span>
        <ArrowRight size={15} />
      </Link>
    </article>
  );
}

export function PlayerRequestCard({ message, currentUser }) {
  const toast = useToast();
  const requestId = message.requestId;
  const snapshot = message.request || {};
  const isOrganizer = Boolean(currentUser?.uid && message.authorId === currentUser.uid);
  const [applyOpen, setApplyOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [role, setRole] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [approvedMatch, setApprovedMatch] = useState(null);

  const requestState = useSubscription(
    (cb) => (requestId && isOrganizer ? subscribePlayerRequest(requestId, cb) : () => {}),
    [requestId, isOrganizer]
  );
  const applicationsState = useSubscription(
    (cb) => (requestId && isOrganizer ? subscribeApplications(requestId, cb) : () => {}),
    [requestId, isOrganizer]
  );
  const myApplicationState = useSubscription(
    (cb) =>
      requestId && !isOrganizer
        ? subscribeMyApplication(requestId, currentUser?.uid, cb)
        : () => {},
    [requestId, isOrganizer, currentUser?.uid]
  );

  const liveRequest = requestState.data?.data || null;
  const summary = liveRequest?.matchSummary || snapshot.matchSummary || {};
  const status = liveRequest?.status || snapshot.status || 'open';
  const applications = (applicationsState.data || []).map((row) => ({ id: row.id, ...row.data }));
  const myApplication = myApplicationState.data?.data || null;
  const roles = summary.neededRoles || snapshot.neededRoles || [];
  const slotsNeeded = Number(summary.slotsNeeded || snapshot.slotsNeeded) || 1;
  const pendingCount = applications.filter((application) => application.status === 'pending').length;
  const approvedCount = applications.filter((application) => application.status === 'approved').length;

  const sortedApplications = useMemo(
    () =>
      [...applications].sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (a.status !== 'pending' && b.status === 'pending') return 1;
        return 0;
      }),
    [applications]
  );

  useEffect(() => {
    if (myApplication?.status !== 'approved' || !requestId) {
      setApprovedMatch(null);
      return undefined;
    }
    let active = true;
    store
      .getDoc(`playerRequests/${requestId}`)
      .then((doc) => {
        if (!active || !doc?.data?.matchId) return;
        setApprovedMatch({ id: doc.data.matchId, ...(doc.data.matchSummary || {}) });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [myApplication?.status, requestId]);

  const submitApplication = async () => {
    if (!requestId || busy) return;
    setBusy('apply');
    try {
      await applyToPlayerRequest({
        requestId,
        user: currentUser,
        role,
        note,
      });
      toast.success('Candidatura inviata: l’organizzatore deve approvarla.');
      setApplyOpen(false);
      setNote('');
    } catch (error) {
      toast.error(
        error?.code === 'permission-denied'
          ? 'Non è stato possibile inviare la candidatura. Controlla le regole Firestore.'
          : error.message || 'Candidatura non inviata.'
      );
    } finally {
      setBusy('');
    }
  };

  const review = async (application, nextStatus) => {
    if (!requestId || busy) return;
    setBusy(`${nextStatus}-${application.id}`);
    try {
      if (nextStatus === 'approved') {
        await approveApplication({
          requestId,
          applicantUid: application.id,
          reviewerUid: currentUser?.uid,
        });
        toast.success(`${application.nickname} è stato approvato.`);
      } else {
        await rejectApplication({
          requestId,
          applicantUid: application.id,
          reviewerUid: currentUser?.uid,
        });
        toast.success('Candidatura rifiutata.');
      }
    } catch (error) {
      toast.error(error.message || 'Operazione non riuscita.');
    } finally {
      setBusy('');
    }
  };

  return (
    <article className="chat-proposal chat-proposal--private">
      <div className="chat-proposal-head">
        <span className="chat-proposal-icon">
          <Lock size={18} />
        </span>
        <div>
          <strong>Ricerca giocatori da gruppo privato</strong>
          <small>Le informazioni sul gruppo restano riservate</small>
        </div>
      </div>

      <div className="chat-proposal-body">
        <div className="chat-proposal-meta">
          <span>
            <CalendarDays size={13} /> {formatMatchWhen(summary)}
          </span>
          <span>
            <MapPin size={13} /> {summary.gym || 'Palestra da definire'}
            {summary.zone ? ` · ${summary.zone}` : ''}
          </span>
          <span>
            <Users size={13} /> Servono {slotsNeeded} {slotsNeeded === 1 ? 'giocatore' : 'giocatori'}
          </span>
          <span>
            <Clock size={13} /> {labelOf(LEVELS, summary.level)} · {labelOf(AGE_BANDS, summary.ageBand)}
          </span>
        </div>
        <div className="chat-proposal-tags">
          {roles.length ? (
            roleLabels(roles).map((label) => <Chip key={label} tone="amber">{label}</Chip>)
          ) : (
            <Chip tone="muted">Nessun ruolo specifico</Chip>
          )}
          <Chip tone="muted">{formatEuros(summary.cost)}</Chip>
        </div>
        {summary.note ? <p className="chat-proposal-note">{summary.note}</p> : null}
        {isOrganizer ? (
          <div className="chat-proposal-stats">
            <span>{pendingCount} in attesa</span>
            <span>{approvedCount} approvati</span>
          </div>
        ) : null}
      </div>

      {isOrganizer ? (
        <button
          type="button"
          className="chat-proposal-action"
          onClick={(event) => {
            event.stopPropagation();
            setManageOpen(true);
          }}
        >
          <span>Gestisci candidature{pendingCount ? ` (${pendingCount})` : ''}</span>
          <UserCheck size={15} />
        </button>
      ) : myApplication ? (
        <div className={`chat-proposal-result ${myApplication.status}`}>
          {myApplication.status === 'approved' ? (
            approvedMatch ? (
              <Link
                to={`/match/${approvedMatch.id}`}
                className="chat-proposal-action"
                onClick={(event) => event.stopPropagation()}
              >
                <span>Approvato · apri il match e iscriviti</span>
                <ArrowRight size={15} />
              </Link>
            ) : (
              <span>Approvato: l’organizzatore ti contatterà a breve.</span>
            )
          ) : myApplication.status === 'rejected' ? (
            <span>Candidatura non accettata.</span>
          ) : (
            <span>Candidatura inviata · in attesa dell’organizzatore.</span>
          )}
        </div>
      ) : status === 'closed' ? (
        <div className="chat-proposal-result rejected">
          <span>Ricerca chiusa.</span>
        </div>
      ) : (
        <button
          type="button"
          className="chat-proposal-action"
          onClick={(event) => {
            event.stopPropagation();
            setApplyOpen(true);
          }}
        >
          <span>Candidati per giocare</span>
          <ArrowRight size={15} />
        </button>
      )}

      <Modal
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        title="Candidati per giocare"
        subtitle="L’organizzatore vede la tua candidatura e decide se approvarla. Il nome del gruppo resta riservato."
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setApplyOpen(false)}>
              Annulla
            </button>
            <button type="button" className="btn btn-primary" onClick={submitApplication} disabled={busy === 'apply'}>
              {busy === 'apply' ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Invia candidatura
            </button>
          </>
        }
      >
        <div className="form">
          <Field label="Il tuo tipo di giocatore" hint="Facoltativo, aiuta l’organizzatore a scegliere.">
            <select className="select" value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="">Non specificato</option>
              {VOLLEY_ROLES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Presentazione" hint="Massimo 300 caratteri. Non inserire dati personali o contatti.">
            <textarea
              className="textarea"
              rows={3}
              maxLength={300}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Es. gioco da centrale, disponibile in zona Bologna Nord…"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        title="Candidature alla ricerca"
        subtitle={`${pendingCount} in attesa · ${approvedCount} approvati`}
        footer={
          <button type="button" className="btn btn-ghost" onClick={() => setManageOpen(false)}>
            Chiudi
          </button>
        }
      >
        {sortedApplications.length === 0 ? (
          <p className="muted small">Nessuna candidatura per ora.</p>
        ) : (
          <ul className="request-applications">
            {sortedApplications.map((application) => (
              <li key={application.id}>
                <div>
                  <strong>{application.nickname}</strong>
                  <small>
                    {application.role ? labelOf(VOLLEY_ROLES, application.role) : 'Ruolo non specificato'}
                    {application.status === 'pending' ? ' · in attesa' : application.status === 'approved' ? ' · approvato' : ' · rifiutato'}
                  </small>
                  {application.note ? <p>{application.note}</p> : null}
                </div>
                {application.status === 'pending' ? (
                  <div className="request-application-actions">
                    <button
                      type="button"
                      className="icon-btn active"
                      onClick={() => review(application, 'approved')}
                      disabled={Boolean(busy)}
                      title="Approva"
                      aria-label={`Approva ${application.nickname}`}
                    >
                      <Check size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => review(application, 'rejected')}
                      disabled={Boolean(busy)}
                      title="Rifiuta"
                      aria-label={`Rifiuta ${application.nickname}`}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : application.status === 'approved' ? (
                  <Chip tone="green">Approvato</Chip>
                ) : (
                  <Chip tone="red">Rifiutato</Chip>
                )}
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </article>
  );
}
