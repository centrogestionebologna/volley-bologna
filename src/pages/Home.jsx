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
import { useAsync, useSubscription } from '../lib/hooks';
import { MatchCard } from '../components/MatchCard';
import { Chip, EmptyState, Spinner } from '../components/ui';
import { formatDateShort } from '../lib/format';
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

  const matchesState = useSubscription(
    (cb) =>
      store.subscribeList(
        'matches',
        { where: [['status', '==', 'open']], orderBy: [['startsAt', 'asc']], limit: 20 },
        cb
      ),
    []
  );
  const matches = matchesState.data || [];
  const upcoming = matches.filter((row) => row.data.startsAt);

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

      <section>
        <div className="section-head">
          <h2>Prossimi match</h2>
          <Link to="/match" className="link-more">
            Vedi tutti <ArrowRight size={15} />
          </Link>
        </div>
        {matchesState.loading ? (
          <Spinner />
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
          <div className="match-list">
            {upcoming.slice(0, 4).map((row) => (
              <MatchCard key={row.id} match={{ id: row.id, ...row.data }} myReg={regMap.get(row.id)} />
            ))}
          </div>
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
