import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarClock,
  CalendarDays,
  HeartHandshake,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { store } from '../backend';
import { useAsync, useSubscription } from '../lib/hooks';
import { listPublicProfiles } from '../services/profiles';
import { subscribeTrusted, subscribeRatings, setTrusted } from '../services/reputation';
import { deleteRecurringRule, toggleRecurringRule } from '../services/matches';
import { Avatar, Chip, EmptyState, Field, Modal, PageHead, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { formatDateShort } from '../lib/format';

export function Organizer() {
  const { uid, nickname } = useAuth();
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState('');

  const myMatches = useSubscription(
    (cb) =>
      store.subscribeList(
        'matches',
        { where: [['organizerId', '==', uid]], orderBy: [['startsAt', 'desc']], limit: 50 },
        cb
      ),
    [uid]
  );

  const rules = useSubscription(
    (cb) =>
      store.subscribeList(
        'recurringMatches',
        { where: [['organizerId', '==', uid]], limit: 50 },
        cb
      ),
    [uid]
  );

  const trustedState = useSubscription((cb) => subscribeTrusted(uid, cb), [uid]);
  const ratingsState = useSubscription((cb) => subscribeRatings(uid, cb), [uid]);

  const trusted = (trustedState.data || []).map((row) => ({ userId: row.id, ...row.data }));
  const ratings = (ratingsState.data || []).map((row) => ({ userId: row.id, ...row.data }));
  const matches = myMatches.data || [];
  const ratingAverage = ratings.length
    ? (ratings.reduce((sum, item) => sum + (item.score || 0), 0) / ratings.length).toFixed(1)
    : '—';

  const runSearch = async (event) => {
    event.preventDefault();
    setSearching(true);
    try {
      const rows = await listPublicProfiles({ search, limit: 20 });
      setResults(rows.filter((row) => row.id !== uid));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSearching(false);
    }
  };

  const addTrusted = async (profile) => {
    setBusy(`add-${profile.uid}`);
    try {
      await setTrusted({
        organizerId: uid,
        userId: profile.uid,
        nickname: profile.nickname,
        trusted: true,
      });
      toast.success(`${profile.nickname} aggiunto agli affidabili.`);
      setAddOpen(false);
      setSearch('');
      setResults([]);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  const removeTrusted = async (user) => {
    setBusy(`remove-${user.userId}`);
    try {
      await setTrusted({ organizerId: uid, userId: user.userId, nickname: user.nickname, trusted: false });
      toast.success('Rimosso dagli affidabili.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  const toggleRule = async (rule) => {
    setBusy(`rule-${rule.id}`);
    try {
      await toggleRecurringRule(rule.id, !rule.data.active);
      toast.success(rule.data.active ? 'Ricorrenza sospesa.' : 'Ricorrenza riattivata.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  const removeRule = async (rule) => {
    if (!window.confirm('Eliminare questa ricorrenza? I match già pubblicati restano.')) return;
    setBusy(`del-${rule.id}`);
    try {
      await deleteRecurringRule(rule.id);
      toast.success('Ricorrenza eliminata.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="page">
      <PageHead
        eyebrow={`Ciao ${nickname}`}
        title="Area organizer"
        sub="Le tue ricorrenze, la tua lista di utenti affidabili e la reputazione che costruisci."
        actions={
          <Link to="/match/nuovo" className="btn btn-primary">
            <Plus size={17} /> Nuovo match
          </Link>
        }
      />

      <div className="stats-grid">
        <div className="stat-card">
          <CalendarDays size={20} />
          <strong>{matches.length}</strong>
          <span>match organizzati</span>
        </div>
        <div className="stat-card">
          <HeartHandshake size={20} />
          <strong>{trusted.length}</strong>
          <span>utenti affidabili</span>
        </div>
        <div className="stat-card">
          <Star size={20} />
          <strong>{ratings.length}</strong>
          <span>valutazioni ricevute</span>
        </div>
        <div className="stat-card">
          <Sparkles size={20} />
          <strong>{ratingAverage}</strong>
          <span>voto medio dei tuoi utenti</span>
        </div>
      </div>

      <div className="organizer-grid">
        <section className="card card-pad">
          <div className="section-head">
            <h2>
              <CalendarClock size={18} /> Match ricorrenti
            </h2>
          </div>
          {(rules.data || []).length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Nessuna ricorrenza"
              text="Quando crei un match puoi attivare la pubblicazione automatica settimanale."
            />
          ) : (
            <ul className="compact-list">
              {rules.data.map((rule) => (
                <li key={rule.id}>
                  <div>
                    <strong>{rule.data.title}</strong>
                    <small>
                      Ogni {['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'][rule.data.weekday]} alle{' '}
                      {rule.data.time} · {rule.data.gym}
                    </small>
                    {rule.data.lastPublishedDate ? (
                      <small>Ultima pubblicazione: {rule.data.lastPublishedDate}</small>
                    ) : null}
                  </div>
                  <div className="row-actions">
                    <Chip tone={rule.data.active ? 'green' : 'muted'}>
                      {rule.data.active ? 'Attiva' : 'Sospesa'}
                    </Chip>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => toggleRule(rule)}
                      disabled={busy === `rule-${rule.id}`}
                    >
                      {rule.data.active ? 'Sospendi' : 'Attiva'}
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => removeRule(rule)}
                      aria-label="Elimina ricorrenza"
                      disabled={busy === `del-${rule.id}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card card-pad">
          <div className="section-head">
            <h2>
              <HeartHandshake size={18} /> Utenti affidabili
            </h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddOpen(true)}>
              <UserPlus size={15} /> Aggiungi
            </button>
          </div>
          <p className="small muted">
            La lista è privata: la vedi solo tu e l’amministrazione. Gli utenti affidabili sono
            evidenziati in verde nelle tue liste iscritti.
          </p>
          {trusted.length === 0 ? (
            <EmptyState icon={HeartHandshake} title="Lista vuota" text="Aggiungi chi si è sempre presentato." />
          ) : (
            <ul className="member-list">
              {trusted.map((user) => (
                <li key={user.userId}>
                  <Avatar name={user.nickname} size="sm" />
                  <div>
                    <strong>{user.nickname}</strong>
                    <small>{user.note || `dal ${formatDateShort(user.createdAt)}`}</small>
                  </div>
                  <Chip tone="green">Affidabile</Chip>
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => removeTrusted(user)}
                    aria-label="Rimuovi"
                    disabled={busy === `remove-${user.userId}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card card-pad">
          <div className="section-head">
            <h2>
              <Star size={18} /> Valutazioni
            </h2>
            <Chip tone="blue">{ratings.length}</Chip>
          </div>
          <p className="small muted">
            Valutazioni e contestazioni non sono visibili agli utenti. Puoi valutarli dalla pagina del
            match, accanto al loro nome.
          </p>
          {ratings.length === 0 ? (
            <EmptyState icon={Star} title="Nessuna valutazione" text="Valuta gli iscritti dai tuoi match." />
          ) : (
            <ul className="compact-list">
              {ratings.map((rating) => (
                <li key={rating.userId}>
                  <div>
                    <strong>{rating.nickname}</strong>
                    <small>{rating.note || 'Nessuna nota'}</small>
                  </div>
                  <span className="rating-stars">
                    {[1, 2, 3, 4, 5].map((score) => (
                      <Star key={score} size={14} className={rating.score >= score ? 'on' : ''} />
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card card-pad">
          <div className="section-head">
            <h2>
              <Users size={18} /> I tuoi match
            </h2>
            <Link to="/match" className="link-more">
              Tutti
            </Link>
          </div>
          {myMatches.loading ? (
            <Spinner />
          ) : matches.length === 0 ? (
            <EmptyState icon={CalendarDays} title="Nessun match" text="Pubblica il tuo primo match." />
          ) : (
            <ul className="compact-list">
              {matches.slice(0, 8).map((row) => (
                <li key={row.id}>
                  <div>
                    <Link to={`/match/${row.id}`}>
                      <strong>{row.data.title}</strong>
                    </Link>
                    <small>
                      {formatDateShort(row.data.startsAt)} · {row.data.confirmedCount || 0}/{row.data.maxPlayers} iscritti
                      {(row.data.waitlistCount || 0) > 0 ? ` · ${row.data.waitlistCount} riserve` : ''}
                    </small>
                  </div>
                  <Chip tone={row.data.status === 'open' ? 'green' : 'muted'}>{row.data.status}</Chip>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Aggiungi un utente affidabile"
        subtitle="Cerca per nickname. La lista resta privata."
      >
        <form className="search-row" onSubmit={runSearch}>
          <div className="search">
            <Search size={17} />
            <input
              type="search"
              placeholder="Cerca nickname…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={searching}>
            Cerca
          </button>
        </form>

        {results.length > 0 ? (
          <ul className="member-list">
            {results.map((profile) => (
              <li key={profile.id}>
                <Avatar name={profile.data.nickname} size="sm" />
                <div>
                  <strong>{profile.data.nickname}</strong>
                  <small>{profile.data.bio || 'Nessuna bio'}</small>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => addTrusted({ uid: profile.id, nickname: profile.data.nickname })}
                  disabled={busy === `add-${profile.id}` || trusted.some((item) => item.userId === profile.id)}
                >
                  {trusted.some((item) => item.userId === profile.id) ? 'Già presente' : 'Aggiungi'}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">Cerca un nickname per aggiungerlo alla tua lista.</p>
        )}
      </Modal>
    </div>
  );
}
