import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ClipboardList,
  Flame,
  MessageCircle,
  Sparkles,
  Trophy,
  UserRound,
  Users,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { store } from '../backend';
import { useAsync } from '../lib/hooks';
import { Chip, EmptyState, Spinner } from '../components/ui';
import { formatDateShort, toDate } from '../lib/format';
import { listMyRegistrations } from '../services/matches';

const HOME_ACTIONS = [
  { key: 'match', to: '/match', icon: ClipboardList, title: 'Trova un match' },
  { key: 'organizza', to: '/match/nuovo', icon: Sparkles, title: 'Organizza' },
  { key: 'impegni', href: '#impegni', icon: Trophy, title: 'I tuoi impegni' },
  { key: 'chat', to: '/chat?focus=1', icon: MessageCircle, title: 'Chat generale' },
  { key: 'gruppi', to: '/gruppi', icon: Users, title: 'Gruppi' },
  { key: 'profilo', to: '/profilo', icon: UserRound, title: 'Profilo' },
];

export function Home() {
  const { uid } = useAuth();

  const matchesState = useAsync(
    () => store.listDocs('matches', { where: [['status', '==', 'open']], limit: 50 }),
    []
  );
  const upcoming = (matchesState.data || [])
    .filter((row) => {
      const start = toDate(row.data.startsAt);
      return start && start.getTime() > Date.now();
    })
    .sort((a, b) => toDate(a.data.startsAt).getTime() - toDate(b.data.startsAt).getTime());

  const myRegs = useAsync(() => (uid ? listMyRegistrations(uid) : Promise.resolve([])), [uid]);
  const regMap = new Map((myRegs.data || []).map((row) => [row.match.id, row.reg]));
  const myUpcoming = (myRegs.data || []).slice(0, 3);

  return (
    <div className="page home-page">
      <section className="home-actions-section" aria-labelledby="home-actions-title">
        <div className="section-head">
          <h2 id="home-actions-title">Cosa vuoi fare?</h2>
        </div>
        <div className="home-actions">
          {HOME_ACTIONS.map((action) => {
            const Icon = action.icon;
            const content = (
              <>
                <span className="home-action-icon">
                  <Icon size={20} />
                </span>
                <strong className="home-action-title">{action.title}</strong>
              </>
            );

            return action.href ? (
              <a key={action.key} href={action.href} className="home-action">
                {content}
              </a>
            ) : (
              <Link key={action.key} to={action.to} className="home-action">
                {content}
              </Link>
            );
          })}
        </div>
      </section>

      <section className="card card-pad">
        <div className="section-head">
          <h2>
            <ClipboardList size={18} /> Prossimi match
          </h2>
          <Link to="/match" className="link-more">
            Vedi tutti <ArrowRight size={15} />
          </Link>
        </div>
        {matchesState.loading ? (
          <Spinner label="Caricamento match…" />
        ) : upcoming.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="Nessun match in programma"
            text="Pubblica il primo match e invita la community."
          >
            <Link to="/match/nuovo" className="btn btn-primary btn-sm">
              Crea un match
            </Link>
          </EmptyState>
        ) : (
          <ul className="compact-list home-match-list">
            {upcoming.slice(0, 4).map((row) => {
              const match = { id: row.id, ...row.data };
              const myReg = regMap.get(match.id);
              const full = (match.confirmedCount || 0) >= match.maxPlayers;
              return (
                <li key={match.id}>
                  <Link to={`/match/${match.id}`} className="home-match-row">
                    <div>
                      <strong>{match.title}</strong>
                      <small>
                        {formatDateShort(match.startsAt)} · {match.time} · {match.gym}
                      </small>
                    </div>
                    {myReg ? (
                      <Chip
                        tone={
                          myReg.status === 'confirmed'
                            ? 'green'
                            : myReg.status === 'offered'
                              ? 'amber'
                              : 'blue'
                        }
                      >
                        {myReg.status === 'confirmed'
                          ? 'Iscritto'
                          : myReg.status === 'offered'
                            ? 'Conferma il posto'
                            : 'In riserva'}
                      </Chip>
                    ) : (
                      <Chip tone={full ? 'amber' : 'green'}>{full ? 'Pieno' : 'Posti liberi'}</Chip>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section id="impegni" className="card card-pad home-anchor">
        <div className="section-head">
          <h2>
            <Flame size={18} /> I tuoi impegni
          </h2>
          <Link to="/profilo" className="link-more">
            Dettagli <ArrowRight size={15} />
          </Link>
        </div>
        {myRegs.loading ? (
          <Spinner />
        ) : myUpcoming.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title="Non hai ancora un match"
            text="Iscriviti a un match aperto: se è pieno entri automaticamente in lista riserva."
          />
        ) : (
          <ul className="compact-list">
            {myUpcoming.map(({ match, reg }) => (
              <li key={match.id}>
                <div>
                  <strong>{match.title}</strong>
                  <small>
                    {formatDateShort(match.startsAt)} · {match.time} · {match.gym}
                  </small>
                </div>
                <Chip tone={reg.status === 'confirmed' ? 'green' : reg.status === 'offered' ? 'amber' : 'blue'}>
                  {reg.status === 'confirmed' ? 'Iscritto' : reg.status === 'offered' ? 'Conferma il posto' : 'In riserva'}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
