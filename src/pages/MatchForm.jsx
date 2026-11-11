import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarClock, Info, Loader2, Lock, Sparkles, Users } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { store } from '../backend';
import { AGE_BANDS, LEVELS, LIMITS } from '../config';
import { createMatch, updateMatch } from '../services/matches';
import { getGroup, getMembership } from '../services/groups';
import { dateKey, timeKey, toDate } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { Field, PageHead, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';

const emptyForm = {
  title: '',
  sport: 'indoor',
  date: '',
  time: '20:30',
  gym: '',
  zone: '',
  cost: 8,
  level: 'intermedio',
  ageBand: 'universitari',
  maxPlayers: 12,
  deadlineHours: 6,
  description: '',
};

function tomorrow() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return dateKey(date);
}

export function MatchForm() {
  const { matchId } = useParams();
  const editing = Boolean(matchId);
  const [searchParams] = useSearchParams();
  const groupId = editing ? '' : searchParams.get('groupId') || '';
  const navigate = useNavigate();
  const toast = useToast();
  const { uid, nickname, profile, isAdmin } = useAuth();

  const [form, setForm] = useState({ ...emptyForm, date: tomorrow(), time: '20:30' });
  const [recurring, setRecurring] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState('weekly');
  const [recurrenceApproval, setRecurrenceApproval] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const existing = useAsync(
    () => (editing ? store.getDoc(`matches/${matchId}`) : Promise.resolve(null)),
    [matchId, editing]
  );
  const groupState = useAsync(
    () => (groupId ? getGroup(groupId) : Promise.resolve(null)),
    [groupId]
  );
  const membershipState = useAsync(
    () => (groupId && uid ? getMembership(groupId, uid) : Promise.resolve(null)),
    [groupId, uid]
  );
  const group = groupState.data ? { id: groupState.data.id, ...groupState.data.data } : null;
  const groupMembership = membershipState.data?.data || null;
  const groupLoading = Boolean(groupId) && (!uid || groupState.loading || membershipState.loading);
  const groupAllowed = !groupId || groupMembership?.status === 'active';

  useEffect(() => {
    if (!existing.data) return;
    const match = existing.data.data;
    setForm({
      title: match.title || '',
      sport: match.sport || 'indoor',
      date: match.date || dateKey(match.startsAt),
      time: match.time || timeKey(match.startsAt),
      gym: match.gym || '',
      zone: match.zone || '',
      cost: match.cost ?? 0,
      level: match.level || 'intermedio',
      ageBand: match.ageBand || 'universitari',
      maxPlayers: match.maxPlayers || 12,
      deadlineHours: match.deadlineHours ?? 6,
      description: match.description || '',
    });
  }, [existing.data]);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const organizerId = existing.data?.data?.organizerId;
  const canEdit = !editing || organizerId === uid || isAdmin;

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!canEdit) return;
    if (groupId && !group) {
      setError('Gruppo non trovato.');
      return;
    }
    if (groupId && !groupAllowed) {
      setError('Solo i membri attivi possono proporre un match in questo gruppo.');
      return;
    }
    setBusy(true);
    try {
      const startsAt = new Date(`${form.date}T${form.time || '20:00'}`);
      if (Number.isNaN(startsAt.getTime())) throw new Error('Data o ora non valide.');
      const payload = {
        ...form,
        startsAt,
        cost: Number(form.cost),
        maxPlayers: Number(form.maxPlayers),
        deadlineHours: Number(form.deadlineHours),
      };
      if (editing) {
        await updateMatch(matchId, payload);
        toast.success('Match aggiornato.');
        navigate(`/match/${matchId}`);
      } else {
        const targetGroup = groupId ? group : null;
        const id = await createMatch(payload, { uid, nickname }, {
          recurring,
          recurrence: { frequency: recurrenceFrequency, approvalMode: recurrenceApproval },
          group: targetGroup,
        });
        if (targetGroup) {
          toast.success(
            targetGroup.visibility === 'private'
              ? 'Proposta inviata al gruppo: non sarà pubblicata nella chat generale.'
              : 'Match proposto al gruppo e pubblicato anche in #generale.'
          );
          navigate(`/gruppi/${groupId}?focus=1`);
        } else {
          toast.success(
            recurring
              ? 'Match creato: la ripubblicazione è programmata.'
              : 'Match creato!'
          );
          navigate(`/match/${id}`);
        }
      }
    } catch (err) {
      setError(err.message || 'Impossibile salvare il match.');
    } finally {
      setBusy(false);
    }
  };

  if (editing && existing.loading) return <Spinner />;
  if (groupLoading) return <Spinner />;
  if (groupId && (!group || !groupAllowed)) {
    return (
      <div className="page">
        <p className="access-denied">
          {group
            ? 'Solo i membri attivi possono proporre un match in questo gruppo.'
            : 'Questo gruppo non esiste o non è più accessibile.'}
        </p>
      </div>
    );
  }
  if (editing && existing.data && !canEdit) {
    return (
      <div className="page">
        <p className="access-denied">Solo l’organizzatore del match può modificarlo.</p>
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      <Link
        to={editing ? `/match/${matchId}` : groupId ? `/gruppi/${groupId}?focus=1` : '/match'}
        className="back-link"
      >
        <ArrowLeft size={15} /> Indietro
      </Link>
      <PageHead
        eyebrow={editing ? 'Modifica' : groupId ? 'Proposta al gruppo' : 'Nuovo match'}
        title={editing ? 'Aggiorna il match' : groupId ? 'Proponi un match' : 'Organizza un match'}
        sub={
          groupId
            ? 'La proposta sarà visibile ai membri del gruppo. Potrai gestire iscritti e dettagli come un normale match.'
            : 'I campi contrassegnati sono obbligatori. Potrai modificare tutto tranne i partecipanti già iscritti.'
        }
      />

      {group ? (
        <div className={`banner ${group.visibility === 'private' ? 'banner-warn' : ''}`}>
          {group.visibility === 'private' ? <Lock size={18} /> : <Users size={18} />}
          <div>
            <strong>
              {group.visibility === 'private' ? 'Gruppo privato' : 'Gruppo pubblico'}: {group.name}
            </strong>
            <span>
              {group.visibility === 'private'
                ? 'La proposta apparirà solo nella chat del gruppo: non sarà pubblicata in #generale né negli elenchi pubblici.'
                : 'La proposta apparirà nella chat del gruppo, in #generale e nell’elenco dei match aperti.'}
            </span>
          </div>
        </div>
      ) : null}

      <form className="card card-pad form" onSubmit={submit}>
        <Field label="Titolo (facoltativo)" hint="Se vuoto generiamo “Volley a …”">
          <input className="input" value={form.title} onChange={set('title')} placeholder="Volley serale a Corticella" maxLength={80} />
        </Field>

        <div className="form-row">
          <Field label="Sport">
            <select className="select" value={form.sport} onChange={set('sport')}>
              <option value="indoor">Indoor</option>
              <option value="beach">Beach volley</option>
            </select>
          </Field>
          <Field label="Costo medio a persona (€)" hint="0 = gratis">
            <input className="input" type="number" min="0" step="1" value={form.cost} onChange={set('cost')} required />
          </Field>
        </div>

        <div className="form-row">
          <Field label="Data *">
            <input className="input" type="date" value={form.date} onChange={set('date')} required />
          </Field>
          <Field label="Ora *">
            <input className="input" type="time" value={form.time} onChange={set('time')} required />
          </Field>
        </div>

        <div className="form-row">
          <Field label="Palestra o zona *">
            <input className="input" value={form.gym} onChange={set('gym')} placeholder="Palestra Corticella" required />
          </Field>
          <Field label="Quartiere / zona">
            <input className="input" value={form.zone} onChange={set('zone')} placeholder="Bologna Nord" />
          </Field>
        </div>

        <div className="form-row form-row-3">
          <Field label="Livello richiesto *">
            <select className="select" value={form.level} onChange={set('level')}>
              {LEVELS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fascia età *">
            <select className="select" value={form.ageBand} onChange={set('ageBand')}>
              {AGE_BANDS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Max giocatori *" hint={`2–${LIMITS.maxPlayers}`}>
            <input
              className="input"
              type="number"
              min="2"
              max={LIMITS.maxPlayers}
              value={form.maxPlayers}
              onChange={set('maxPlayers')}
              required
            />
          </Field>
        </div>

        <Field
          label="Deadline per disiscrizione *"
          hint="Ore prima dell’inizio. Dopo la deadline le disdette passano dall’organizzatore."
        >
          <select className="select" value={form.deadlineHours} onChange={set('deadlineHours')}>
            {[0, 1, 2, 4, 6, 12, 24, 48].map((hours) => (
              <option key={hours} value={hours}>
                {hours === 0 ? 'Nessuna (fino all’inizio)' : `${hours} ore prima`}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Note per i giocatori">
          <textarea
            className="textarea"
            rows={3}
            value={form.description}
            onChange={set('description')}
            placeholder="Maglia chiara/scura, rotazioni, docce, parcheggio…"
            maxLength={800}
          />
        </Field>

        {!editing ? (
          <>
            <label className="recurring-toggle">
              <input
                type="checkbox"
                checked={recurring}
                onChange={(event) => setRecurring(event.target.checked)}
              />
              <span className="recurring-icon">
                <CalendarClock size={20} />
              </span>
              <span>
                <strong>Programma la ripubblicazione</strong>
                <small>
                  Ogni {['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'][new Date(`${form.date}T${form.time || '20:00'}`).getDay()] || 'settimana'} alle{' '}
                  {form.time} creeremo il nuovo match con gli stessi dati. Scegli cadenza e approvazione qui sotto.
                </small>
              </span>
            </label>

            {recurring ? (
              <div className="recurring-advanced">
                <div className="form-row">
                  <Field label="Cadenza">
                    <select
                      className="select"
                      value={recurrenceFrequency}
                      onChange={(event) => setRecurrenceFrequency(event.target.value)}
                    >
                      <option value="weekly">Ogni settimana</option>
                      <option value="biweekly">Ogni 2 settimane</option>
                      <option value="monthly">Ogni mese</option>
                    </select>
                  </Field>
                  <Field label="Ripubblicazione">
                    <select
                      className="select"
                      value={recurrenceApproval}
                      onChange={(event) => setRecurrenceApproval(event.target.value)}
                    >
                      <option value="auto">Automatica</option>
                      <option value="founder">Con approvazione del fondatore</option>
                    </select>
                  </Field>
                </div>
                <p className="hint">
                  <Info size={14} />{' '}
                  {recurrenceApproval === 'founder'
                    ? 'Ogni ricorrenza genera una richiesta nell’area organizer: il match verrà creato solo dopo l’approvazione del fondatore.'
                    : 'Il match verrà creato automaticamente alla cadenza scelta, senza ulteriori conferme.'}
                </p>
              </div>
            ) : null}
          </>
        ) : null}

        {profile && !profile.verified ? (
          <p className="hint">
            <Sparkles size={14} /> Suggerimento: completa la verifica del profilo per dare più fiducia ai
            giocatori.
          </p>
        ) : null}

        {error ? <div className="form-error">{error}</div> : null}

        <div className="form-actions">
          <Link
            to={editing ? `/match/${matchId}` : groupId ? `/gruppi/${groupId}?focus=1` : '/match'}
            className="btn btn-ghost"
          >
            Annulla
          </Link>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : null}
            {editing ? 'Salva modifiche' : groupId ? 'Invia proposta' : 'Pubblica match'}
          </button>
        </div>
      </form>
    </div>
  );
}
