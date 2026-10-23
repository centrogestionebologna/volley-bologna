import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CalendarDays,
  ClipboardList,
  Flame,
  MessageCircle,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { store } from '../backend';
import { useAsync, useSubscription } from '../lib/hooks';
import { MatchCard } from '../components/MatchCard';
import { Avatar, Chip, EmptyState, Spinner } from '../components/ui';
import { formatDateShort, formatRelative } from '../lib/format';
import { listMyRegistrations } from '../services/matches';
import { generalChatPath, subscribeMessages } from '../services/chat';

export function Home() {
  const { uid, nickname, isDemo, isAdmin, profile } = useAuth();

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

  const groupsState = useSubscription(
    (cb) => store.subscribeList('groups', { orderBy: [['createdAt', 'desc']], limit: 12 }, cb),
    []
  );
  const groups = groupsState.data || [];

  const chat = useSubscription((cb) => subscribeMessages(generalChatPath, cb, 6), []);
  const lastMessages = (chat.data || []).slice(-3).reverse();

  const next = upcoming[0];
  const regMap = new Map((myRegs.data || []).map((row) => [row.match.id, row.reg]));
  const myUpcoming = (myRegs.data || []).slice(0, 3);

  return (
    <div className="page">
      <section className="home-hero">
        <div className="home-hero-copy">
          <span className="eyebrow">
            {new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
          </span>
          <h1>
            Ciao {nickname}, <span>si gioca?</span>
          </h1>
          <p>
            {matches.length > 0
              ? `${matches.length} match aperti a Bologna e dintorni. Il prossimo è ${next?.data.title}.`
              : 'Nessun match aperto al momento: crea tu il prossimo!'}
          </p>
          <div className="hero-actions">
            <Link to="/match" className="btn btn-primary">
              <CalendarDays size={17} /> Trova un match
            </Link>
            <Link to="/match/nuovo" className="btn btn-ghost">
              <Sparkles size={17} /> Organizza
            </Link>
          </div>
          {profile && !profile.verified ? (
            <Link to="/profilo" className="hero-verify">
              <Trophy size={15} /> Completa il profilo e richiedi la verifica
              <ArrowRight size={15} />
            </Link>
          ) : null}
        </div>
        <div className="home-hero-art" aria-hidden>
          <span className="hero-ball">🏐</span>
          <span className="hero-ring hero-ring-1" />
          <span className="hero-ring hero-ring-2" />
          <span className="hero-badge">
            <strong>30′</strong>
            <small>per confermare la riserva</small>
          </span>
        </div>
      </section>

      <div className="home-grid">
        <div className="home-main">
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

          <section className="card card-pad">
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

        <aside className="home-side">
          <section className="card card-pad">
            <div className="section-head">
              <h2>
                <MessageCircle size={18} /> Chat generale
              </h2>
              <Link to="/chat" className="link-more">
                Apri
              </Link>
            </div>
            {lastMessages.length === 0 ? (
              <p className="muted small">Nessun messaggio recente.</p>
            ) : (
              <ul className="chat-preview">
                {lastMessages.map((message) => (
                  <li key={message.id}>
                    <Avatar name={message.authorNickname} size="xs" />
                    <div>
                      <strong>{message.authorNickname}</strong>
                      <p>{message.deleted ? 'Messaggio eliminato' : message.text}</p>
                    </div>
                    <time>{formatRelative(message.createdAt)}</time>
                  </li>
                ))}
              </ul>
            )}
            <Link to="/chat" className="btn btn-ghost btn-sm btn-block">
              <MessageCircle size={15} /> Scrivi in chat
            </Link>
          </section>

          <section className="card card-pad">
            <div className="section-head">
              <h2>
                <Users size={18} /> Gruppi
              </h2>
              <Link to="/gruppi" className="link-more">
                Tutti
              </Link>
            </div>
            <ul className="compact-list">
              {groups.slice(0, 4).map((row) => (
                <li key={row.id}>
                  <div>
                    <strong>{row.data.name}</strong>
                    <small>{row.data.memberCount || 1} membri · {row.data.visibility === 'private' ? 'privato' : 'pubblico'}</small>
                  </div>
                  <Link to={`/gruppi/${row.id}`} className="icon-btn" aria-label="Apri gruppo">
                    <ArrowRight size={16} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {isDemo ? (
            <section className="card card-pad demo-tips">
              <h2>
                <Sparkles size={18} /> Prova la demo
              </h2>
              <p className="small">
                Cambia account dal profilo per vedere ruoli diversi. Marco ha un posto riservato in
                scadenza al Talon; Giulia gestisce le riserve; Adriano modera.
              </p>
              {isAdmin ? (
                <Link to="/admin" className="btn btn-ghost btn-sm btn-block">
                  Apri amministrazione
                </Link>
              ) : null}
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
