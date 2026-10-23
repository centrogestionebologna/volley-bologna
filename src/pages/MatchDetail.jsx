import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  CalendarDays,
  Euro,
  Flag,
  Gavel,
  HeartHandshake,
  Hourglass,
  MapPin,
  Pencil,
  ShieldAlert,
  Star,
  Trash2,
  UserMinus,
  Users,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { store } from '../backend';
import { AGE_BANDS, LEVELS, LIMITS, labelOf } from '../config';
import { useAsync, useSubscription } from '../lib/hooks';
import { formatDateTime, formatEuros, toDate } from '../lib/format';
import {
  cancelSignup,
  confirmSeat,
  declineSeat,
  removeParticipant,
  setMatchStatus,
  signUpForMatch,
  subscribeMatch,
  subscribeRegistrations,
} from '../services/matches';
import { subscribeRatings, subscribeTrusted, rateUser, setTrusted } from '../services/reputation';
import { createReport, hasIdentityAccess } from '../services/moderation';
import { Avatar, Chip, EmptyState, Modal, PageHead, Progress, Spinner } from '../components/ui';
import { Countdown } from '../components/Countdown';
import { useToast } from '../components/Toast';

export function MatchDetail() {
  const { matchId } = useParams();
  const { uid, nickname, profile, isAdmin, isBanned, isSilenced } = useAuth();
  const toast = useToast();

  const matchState = useSubscription((cb) => subscribeMatch(matchId, cb), [matchId]);
  const regsState = useSubscription((cb) => subscribeRegistrations(matchId, cb), [matchId]);

  const match = matchState.data ? { id: matchState.data.id, ...matchState.data.data } : null;
  const registrations = (regsState.data || []).map((row) => ({ id: row.id, ...row.data }));
  const isOrganizer = Boolean(match && match.organizerId === uid);

  const trustedState = useSubscription(
    (cb) => (isOrganizer ? subscribeTrusted(uid, cb) : () => {}),
    [isOrganizer, uid]
  );
  const ratingsState = useSubscription(
    (cb) => (isOrganizer ? subscribeRatings(uid, cb) : () => {}),
    [isOrganizer, uid]
  );
  const trusted = new Map((trustedState.data || []).map((row) => [row.id, row.data]));
  const myRatings = new Map((ratingsState.data || []).map((row) => [row.id, row.data]));

  const [busy, setBusy] = useState('');
  const [details, setDetails] = useState(null);
  const [irregularity, setIrregularity] = useState(null);
  const [reason, setReason] = useState('');
  const [ratingTarget, setRatingTarget] = useState(null);
  const [ratingScore, setRatingScore] = useState(5);
  const [ratingNote, setRatingNote] = useState('');

  const myReg = registrations.find((reg) => reg.uid === uid);
  const confirmed = registrations
    .filter((reg) => reg.status === 'confirmed')
    .sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const waitlist = registrations
    .filter((reg) => reg.status === 'waitlist' || reg.status === 'offered')
    .sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const myWaitlistIndex = waitlist.findIndex((reg) => reg.uid === uid);
  const deadline = toDate(match?.deadlineAt);
  const deadlinePassed = Boolean(deadline && deadline.getTime() < Date.now());
  const start = toDate(match?.startsAt);
  const started = Boolean(start && start.getTime() < Date.now());
  const full = Boolean(match && (match.confirmedCount || 0) >= match.maxPlayers);
  const pendingOffer = match?.pendingOffer || null;

  const myOffer = pendingOffer && pendingOffer.uid === uid ? pendingOffer : null;

  const data = match
    ? [
        { icon: CalendarDays, label: 'Data', value: formatDateTime(match.startsAt) },
        { icon: MapPin, label: 'Palestra / zona', value: `${match.gym}${match.zone ? ` · ${match.zone}` : ''}` },
        { icon: Euro, label: 'Costo medio', value: formatEuros(match.cost) },
        { icon: Users, label: 'Livello richiesto', value: labelOf(LEVELS, match.level) },
        { icon: Users, label: 'Fascia età', value: labelOf(AGE_BANDS, match.ageBand) },
        { icon: Users, label: 'Max giocatori', value: `${match.maxPlayers}` },
        {
          icon: Hourglass,
          label: 'Deadline disiscrizione',
          value: `${formatDateTime(match.deadlineAt)} (${match.deadlineHours} h prima)`,
        },
        { icon: CalendarClock, label: 'Organizzatore', value: match.organizerNickname },
      ]
    : [];

  const run = async (key, action, successMessage) => {
    setBusy(key);
    try {
      await action();
      if (successMessage) toast.success(successMessage);
    } catch (error) {
      toast.error(error.message || 'Operazione non riuscita.');
    } finally {
      setBusy('');
    }
  };

  const signUp = () =>
    run(
      'signup',
      async () => {
        const status = await signUpForMatch({ matchId, user: { uid }, nickname });
        toast.success(
          status === 'confirmed'
            ? 'Iscrizione confermata! Ci vediamo in campo 🏐'
            : 'Sei in lista riserva: ti avviseremo appena si libera un posto.'
        );
        if (status === 'waitlist') {
          // messaggio informativo già mostrato
        }
      },
      null
    );

  const cancel = () => {
    if (!window.confirm('Vuoi disiscriverti da questo match?')) return;
    run('cancel', () => cancelSignup({ matchId, uid }), 'Iscrizione annullata.');
  };

  const confirm = () =>
    run('confirm', () => confirmSeat({ matchId, uid }), 'Posto confermato! Ci vediamo in campo 🏐');

  const decline = () => {
    if (!window.confirm('Rifiutare il posto? Passerà alla riserva successiva.')) return;
    run('decline', () => declineSeat({ matchId, uid }), 'Posto rifiutato.');
  };

  const remove = (reg) => {
    if (!window.confirm(`Rimuovere ${reg.nickname} dal match?`)) return;
    run(`remove-${reg.uid}`, () => removeParticipant({ matchId, uid: reg.uid }), `${reg.nickname} rimosso.`);
  };

  const openDetails = async (reg) => {
    setBusy(`details-${reg.uid}`);
    try {
      const allowed = isAdmin || (await hasIdentityAccess(uid, reg.uid));
      if (!allowed) {
        setIrregularity(reg);
        setReason('');
        return;
      }
      const doc = await store.getDoc(`users/${reg.uid}`);
      setDetails({ nickname: reg.nickname, ...(doc?.data || {}) });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  const submitIrregularity = async () => {
    if (!irregularity) return;
    setBusy('irregularity');
    try {
      await createReport({
        type: 'irregularity',
        targetId: irregularity.uid,
        targetUserId: irregularity.uid,
        targetNickname: irregularity.nickname,
        matchId,
        reason,
        reporter: { uid, nickname: profile?.nickname || nickname },
      });
      const doc = await store.getDoc(`users/${irregularity.uid}`);
      setDetails({ nickname: irregularity.nickname, ...(doc?.data || {}) });
      setIrregularity(null);
      toast.success('Segnalazione inviata: ora puoi vedere i dati reali per 7 giorni.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  const toggleTrust = (reg) =>
    run(
      `trust-${reg.uid}`,
      () =>
        setTrusted({
          organizerId: uid,
          userId: reg.uid,
          nickname: reg.nickname,
          trusted: !trusted.has(reg.uid),
        }),
      trusted.has(reg.uid) ? 'Rimosso dagli affidabili.' : 'Aggiunto agli utenti affidabili.'
    );

  const submitRating = async () => {
    if (!ratingTarget) return;
    setBusy('rating');
    try {
      await rateUser({
        organizerId: uid,
        userId: ratingTarget.uid,
        nickname: ratingTarget.nickname,
        score: ratingScore,
        note: ratingNote,
      });
      toast.success('Valutazione salvata (visibile solo a te e all’admin).');
      setRatingTarget(null);
      setRatingNote('');
      setRatingScore(5);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  const closeSignups = () => {
    if (!window.confirm('Chiudere le iscrizioni a questo match?')) return;
    run('close', () => setMatchStatus(matchId, 'closed'), 'Iscrizioni chiuse.');
  };

  if (matchState.loading) return <Spinner />;
  if (!match) {
    return (
      <EmptyState icon={ShieldAlert} title="Match non trovato" text="Potrebbe essere stato eliminato.">
        <Link to="/match" className="btn btn-ghost">
          Torna ai match
        </Link>
      </EmptyState>
    );
  }

  const renderParticipant = (reg, index, list) => {
    const isTrusted = trusted.has(reg.uid);
    const rating = myRatings.get(reg.uid);
    return (
      <li key={reg.id} className={`participant ${isTrusted ? 'participant-trusted' : ''}`}>
        <span className="participant-index">{index + 1}</span>
        <Avatar name={reg.nickname} size="sm" />
        <div className="participant-info">
          <strong>
            {reg.nickname}
            {reg.uid === uid ? <span className="you-tag">tu</span> : null}
          </strong>
          <small>
            {reg.status === 'offered'
              ? 'Posto offerto · in attesa di conferma'
              : reg.status === 'waitlist'
                ? `Riserva #${list.filter((r, i) => i <= index && r.status !== 'confirmed').length}`
                : 'Iscritto'}
            {isTrusted ? ' · affidabile' : ''}
            {rating ? ` · tua valutazione ${rating.score}/5` : ''}
          </small>
        </div>
        {isTrusted ? <Chip tone="green" icon={BadgeCheck}>Affidabile</Chip> : null}
        {isOrganizer || isAdmin ? (
          <div className="participant-actions">
            <button
              type="button"
              className={`icon-btn ${isTrusted ? 'active' : ''}`}
              onClick={() => toggleTrust(reg)}
              title="Segna come affidabile"
              aria-label="Segna come affidabile"
              disabled={busy === `trust-${reg.uid}`}
            >
              <HeartHandshake size={16} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => {
                setRatingTarget(reg);
                setRatingScore(rating?.score || 5);
                setRatingNote(rating?.note || '');
              }}
              title="Valuta utente"
              aria-label="Valuta utente"
            >
              <Star size={16} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => openDetails(reg)}
              title="Dati / irregolarità"
              aria-label="Dati o segnalazione"
              disabled={busy === `details-${reg.uid}`}
            >
              <Flag size={16} />
            </button>
            <button
              type="button"
              className="icon-btn danger"
              onClick={() => remove(reg)}
              title="Rimuovi dal match"
              aria-label="Rimuovi dal match"
              disabled={busy === `remove-${reg.uid}`}
            >
              <UserMinus size={16} />
            </button>
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <div className="page">
      <Link to="/match" className="back-link">
        <ArrowLeft size={15} /> Tutti i match
      </Link>

      <PageHead
        eyebrow={match.sport === 'beach' ? 'Beach volley' : 'Indoor'}
        title={match.title}
        sub={`${formatDateTime(match.startsAt)} · ${match.gym}`}
        actions={
          isOrganizer ? (
            <div className="row-actions">
              <Link to={`/match/${matchId}/modifica`} className="btn btn-ghost btn-sm">
                <Pencil size={15} /> Modifica
              </Link>
              {match.status === 'open' ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={closeSignups}>
                  Chiudi iscrizioni
                </button>
              ) : null}
            </div>
          ) : null
        }
      />

      {match.status !== 'open' ? (
        <div className="banner banner-warn">
          <ShieldAlert size={18} />
          <div>
            <strong>{match.status === 'cancelled' ? 'Match annullato' : 'Iscrizioni chiuse'}</strong>
            <span>Non è più possibile iscriversi.</span>
          </div>
        </div>
      ) : null}

      {myOffer ? (
        <div className="offer-box">
          <div className="offer-box-head">
            <div>
              <strong>Hai un posto riservato! 🎉</strong>
              <p>
                Ti sei liberato un posto. Conferma entro il tempo indicato, altrimenti passiamo
                automaticamente alla riserva successiva.
              </p>
            </div>
            <Countdown expiresAt={myOffer.expiresAt} />
          </div>
          <div className="row-actions">
            <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy === 'confirm'}>
              Conferma posto
            </button>
            <button type="button" className="btn btn-ghost" onClick={decline} disabled={busy === 'decline'}>
              Rifiuta
            </button>
          </div>
        </div>
      ) : null}

      <div className="detail-grid">
        <div className="detail-main">
          <section className="card card-pad">
            <h2 className="card-title">Informazioni</h2>
            <div className="info-grid">
              {data.map((item) => (
                <div key={item.label} className="info-item">
                  <span className="info-icon">
                    <item.icon size={17} />
                  </span>
                  <div>
                    <small>{item.label}</small>
                    <strong>{item.value}</strong>
                  </div>
                </div>
              ))}
            </div>
            {match.description ? <p className="match-description">{match.description}</p> : null}
            {match.recurringId ? (
              <Chip tone="violet" icon={CalendarClock}>
                Match ricorrente settimanale
              </Chip>
            ) : null}
          </section>

          <section className="card card-pad">
            <div className="section-head">
              <h2>
                Iscritti <span className="count-badge">{match.confirmedCount || 0}/{match.maxPlayers}</span>
              </h2>
              {pendingOffer ? (
                <Chip tone="amber" icon={Hourglass}>
                  In attesa di {pendingOffer.nickname}
                </Chip>
              ) : null}
            </div>
            <Progress value={match.confirmedCount || 0} max={match.maxPlayers} />
            {confirmed.length === 0 ? (
              <p className="muted small">Nessun iscritto: puoi essere il primo.</p>
            ) : (
              <ul className="participant-list">{confirmed.map((reg, index) => renderParticipant(reg, index, confirmed))}</ul>
            )}

            <div className="section-head sub-head">
              <h2>
                Lista riserve <span className="count-badge">{waitlist.length}</span>
              </h2>
              <Chip tone="blue">Ordine cronologico</Chip>
            </div>
            {waitlist.length === 0 ? (
              <p className="muted small">Nessuna riserva al momento.</p>
            ) : (
              <ul className="participant-list">{waitlist.map((reg, index) => renderParticipant(reg, index, waitlist))}</ul>
            )}
          </section>
        </div>

        <aside className="detail-side">
          <section className="card card-pad">
            {myReg ? (
              <>
                <h2 className="card-title">
                  {myReg.status === 'confirmed'
                    ? 'Sei iscritto ✅'
                    : myReg.status === 'offered'
                      ? 'Posto riservato ⏳'
                      : `Sei in lista riserva`}
                </h2>
                {myReg.status === 'waitlist' ? (
                  <p className="muted small">
                    Posizione {myWaitlistIndex + 1} su {waitlist.length}. Ti contatteremo appena si libera
                    un posto e avrai {LIMITS.offerMinutes} minuti per confermare.
                  </p>
                ) : null}
                {myReg.status === 'offered' ? (
                  <div className="offer-mini">
                    <Countdown expiresAt={myReg.offerExpiresAt} />
                    <div className="row-actions">
                      <button type="button" className="btn btn-primary btn-sm" onClick={confirm} disabled={busy === 'confirm'}>
                        Conferma
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={decline} disabled={busy === 'decline'}>
                        Rifiuta
                      </button>
                    </div>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  onClick={cancel}
                  disabled={busy === 'cancel' || deadlinePassed}
                >
                  <Trash2 size={15} /> Disiscriviti
                </button>
                {deadlinePassed ? (
                  <p className="hint">
                    Deadline superata: per disiscriverti contatta {match.organizerNickname}.
                  </p>
                ) : null}
              </>
            ) : isBanned ? (
              <div className="access-denied">
                <ShieldAlert size={18} /> Il tuo account è sospeso: non puoi iscriverti.
              </div>
            ) : match.status !== 'open' || started ? (
              <p className="muted small">
                {started ? 'Il match è già iniziato.' : 'Le iscrizioni sono chiuse.'}
              </p>
            ) : (
              <>
                <h2 className="card-title">{full ? 'Match pieno' : 'Ci sono ancora posti'}</h2>
                <p className="muted small">
                  {full || pendingOffer
                    ? 'Iscrivendoti entri in lista riserva. Ti avvisiamo se si libera un posto.'
                    : `Restano ${match.maxPlayers - (match.confirmedCount || 0)} posti. Iscrizione immediata.`}
                </p>
                <button type="button" className="btn btn-primary btn-block" onClick={signUp} disabled={busy === 'signup'}>
                  {full || pendingOffer ? 'Entra in lista riserva' : 'Iscriviti al match'}
                </button>
              </>
            )}
            {isSilenced ? (
              <p className="hint">Sei in silenzio temporaneo: puoi iscriverti ma non scrivere in chat.</p>
            ) : null}
          </section>

          <section className="card card-pad">
            <h2 className="card-title">Organizzatore</h2>
            <div className="organizer-card">
              <Avatar name={match.organizerNickname} size="md" />
              <div>
                <strong>{match.organizerNickname}</strong>
                <small>Organizza su Volley Bologna</small>
              </div>
            </div>
            <ul className="plain-list">
              <li>
                <CalendarDays size={15} /> Deadline disiscrizione {match.deadlineHours} h prima
              </li>
              <li>
                <Hourglass size={15} /> Riserve contattate una alla volta
              </li>
              <li>
                <Gavel size={15} /> Segnala irregolarità dai partecipanti
              </li>
            </ul>
            {isOrganizer ? (
              <div className="organizer-tools">
                <p className="small">
                  In qualità di organizzatore puoi rimuovere un iscritto, segnare un utente come
                  affidabile e aprire una segnalazione per irregolarità.
                </p>
                <Link to="/organizzatore" className="btn btn-ghost btn-sm btn-block">
                  La tua area organizer
                </Link>
              </div>
            ) : null}
          </section>
        </aside>
      </div>

      <Modal
        open={Boolean(details)}
        onClose={() => setDetails(null)}
        title="Dati del partecipante"
        subtitle="Visibili per 7 giorni dalla segnalazione di irregolarità."
      >
        {details ? (
          <div className="data-grid">
            <div>
              <small>Nickname</small>
              <strong>{details.nickname}</strong>
            </div>
            <div>
              <small>Nome e cognome</small>
              <strong>
                {details.realName || '—'} {details.surname || ''}
              </strong>
            </div>
            <div>
              <small>Email</small>
              <strong>{details.email || '—'}</strong>
            </div>
            <div>
              <small>Telefono</small>
              <strong>{details.phone || 'Non indicato'}</strong>
            </div>
            <div>
              <small>Identità verificata</small>
              <strong>{details.verified ? 'Sì' : 'No'}</strong>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(irregularity)}
        onClose={() => setIrregularity(null)}
        title="Segnala irregolarità"
        subtitle="Serve un motivo: dopo l’invio vedrai i dati reali del partecipante e l’admin riceverà la segnalazione."
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setIrregularity(null)}>
              Annulla
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={submitIrregularity}
              disabled={!reason.trim() || busy === 'irregularity'}
            >
              Invia segnalazione
            </button>
          </>
        }
      >
        <div className="report-quote">
          <strong>{irregularity?.nickname}</strong>
          <span>Match: {match.title}</span>
        </div>
        <label className="field">
          <span className="field-label">Cosa è successo?</span>
          <textarea
            className="textarea"
            rows={4}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Es. si è iscritto e non si è presentato, comportamento scorretto…"
          />
        </label>
      </Modal>

      <Modal
        open={Boolean(ratingTarget)}
        onClose={() => setRatingTarget(null)}
        title={`Valuta ${ratingTarget?.nickname || ''}`}
        subtitle="La valutazione e il conteggio sono visibili solo a te e all’amministrazione."
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setRatingTarget(null)}>
              Annulla
            </button>
            <button type="button" className="btn btn-primary" onClick={submitRating} disabled={busy === 'rating'}>
              Salva valutazione
            </button>
          </>
        }
      >
        <div className="rating-row">
          {[1, 2, 3, 4, 5].map((score) => (
            <button
              key={score}
              type="button"
              className={`star-btn ${ratingScore >= score ? 'on' : ''}`}
              onClick={() => setRatingScore(score)}
              aria-label={`${score} stelle`}
            >
              <Star size={26} />
            </button>
          ))}
          <span>{ratingScore}/5</span>
        </div>
        <label className="field">
          <span className="field-label">Nota privata (facoltativa)</span>
          <textarea
            className="textarea"
            rows={3}
            value={ratingNote}
            onChange={(event) => setRatingNote(event.target.value)}
            placeholder="Es. puntuale, ottimo compagno di squadra…"
          />
        </label>
      </Modal>
    </div>
  );
}
