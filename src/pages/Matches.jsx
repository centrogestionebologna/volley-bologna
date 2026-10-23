import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ClipboardList, Plus, Search } from 'lucide-react';
import { store } from '../backend';
import { AGE_BANDS, LEVELS } from '../config';
import { useAsync, useSubscription } from '../lib/hooks';
import { useAuth } from '../auth/AuthProvider';
import { MatchCard } from '../components/MatchCard';
import { EmptyState, PageHead, Spinner } from '../components/ui';
import { listMyRegistrations } from '../services/matches';

export function Matches() {
  const { uid } = useAuth();
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('all');
  const [ageBand, setAgeBand] = useState('all');
  const [onlyFree, setOnlyFree] = useState(false);

  const state = useSubscription(
    (cb) =>
      store.subscribeList(
        'matches',
        { where: [['status', '==', 'open']], orderBy: [['startsAt', 'asc']], limit: 60 },
        cb
      ),
    []
  );

  const myRegs = useAsync(() => (uid ? listMyRegistrations(uid) : Promise.resolve([])), [uid]);
  const regMap = new Map((myRegs.data || []).map((row) => [row.match.id, row.reg]));

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (state.data || [])
      .map((row) => ({ id: row.id, ...row.data }))
      .filter((match) => {
        if (level !== 'all' && match.level !== level) return false;
        if (ageBand !== 'all' && match.ageBand !== ageBand) return false;
        if (onlyFree) {
          const free = (match.confirmedCount || 0) < match.maxPlayers && !match.pendingOffer;
          if (!free) return false;
        }
        if (!term) return true;
        return [match.title, match.gym, match.zone, match.organizerNickname]
          .join(' ')
          .toLowerCase()
          .includes(term);
      });
  }, [state.data, search, level, ageBand, onlyFree]);

  return (
    <div className="page">
      <PageHead
        eyebrow="Bologna e provincia"
        title="Match aperti"
        sub="Iscriviti: se i posti sono finiti entri in lista riserva e vieni contattato in automatico."
        actions={
          <Link to="/match/nuovo" className="btn btn-primary">
            <Plus size={17} /> Organizza un match
          </Link>
        }
      />

      <div className="filter-bar card">
        <label className="search">
          <Search size={17} />
          <input
            type="search"
            placeholder="Cerca palestra, zona o organizzatore…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select className="select" value={level} onChange={(event) => setLevel(event.target.value)}>
          <option value="all">Tutti i livelli</option>
          {LEVELS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <select className="select" value={ageBand} onChange={(event) => setAgeBand(event.target.value)}>
          <option value="all">Tutte le fasce età</option>
          {AGE_BANDS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <label className="check">
          <input
            type="checkbox"
            checked={onlyFree}
            onChange={(event) => setOnlyFree(event.target.checked)}
          />
          <span>Solo con posti liberi</span>
        </label>
      </div>

      {state.loading ? (
        <Spinner />
      ) : matches.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Nessun match trovato"
          text="Prova a cambiare i filtri oppure organizza tu un nuovo match."
        >
          <Link to="/match/nuovo" className="btn btn-primary btn-sm">
            <Plus size={15} /> Crea match
          </Link>
        </EmptyState>
      ) : (
        <>
          <div className="result-count">
            <CalendarDays size={15} /> {matches.length} match
          </div>
          <div className="match-grid-2">
            {matches.map((match) => (
              <MatchCard key={match.id} match={match} myReg={regMap.get(match.id)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
