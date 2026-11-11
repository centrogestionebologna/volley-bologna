import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CalendarDays,
  ClipboardList,
  MessageCircle,
  Plus,
  Search,
  UserRound,
  Users,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { store } from '../backend';
import { useAsync } from '../lib/hooks';
import { Logo } from '../components/Logo';
import { Spinner } from '../components/ui';
import { formatDateShort, toDate } from '../lib/format';
import { listMyRegistrations } from '../services/matches';

function registrationLabel(reg) {
  if (!reg) return '';
  if (reg.status === 'confirmed') return 'Iscritto';
  if (reg.status === 'offered') return 'Conferma il posto';
  return 'In riserva';
}

function registrationTone(reg) {
  if (!reg) return 'free';
  if (reg.status === 'confirmed') return 'confirmed';
  if (reg.status === 'offered') return 'offered';
  return 'waitlist';
}

export function Home() {
  const { uid, nickname } = useAuth();

  const matchesState = useAsync(
    () => store.listDocs('matches', { where: [['status', '==', 'open']], limit: 50 }),
    []
  );
  const upcoming = (matchesState.data || [])
    .filter((row) => {
      if (row.data.visibility === 'group-private') return false;
      const start = toDate(row.data.startsAt);
      return start && start.getTime() > Date.now();
    })
    .sort((a, b) => toDate(a.data.startsAt).getTime() - toDate(b.data.startsAt).getTime());

  const myRegs = useAsync(() => (uid ? listMyRegistrations(uid) : Promise.resolve([])), [uid]);
  const regMap = new Map((myRegs.data || []).map((row) => [row.match.id, row.reg]));
  const myUpcoming = (myRegs.data || [])
    .filter((row) => {
      const start = toDate(row.match?.startsAt);
      return start && start.getTime() > Date.now();
    })
    .sort(
      (a, b) =>
        (toDate(a.match?.startsAt)?.getTime() || 0) - (toDate(b.match?.startsAt)?.getTime() || 0)
    );
  const next = myUpcoming[0];
  const displayName = String(nickname || 'giocatore').trim();

  return (
    <div className="page home-page home-page--dark">
      <section className="home-dark-hero">
        <div className="home-dark-hero-copy">
          <span className="eyebrow">Bologna · community pallavolo</span>
          <h1>
            Ciao, <span>{displayName}</span>.
          </h1>
          <p>
            Trova una partita, organizza il prossimo match o entra nella chat della community.
            Tutto quello che serve, in un posto solo.
          </p>
          <div className="home-dark-actions">
            <Link to="/match" className="home-dark-btn home-dark-btn-primary">
              <Search size={18} /> Trova un match
            </Link>
            <Link to="/match/nuovo" className="home-dark-btn home-dark-btn-ghost">
              <Plus size={18} /> Organizza
            </Link>
          </div>
        </div>
        <div className="home-dark-hero-art" aria-hidden="true">
          <Logo size={128} className="home-dark-hero-logo" />
          <span>Gioca. Connettiti. Torna in campo.</span>
        </div>
      </section>

      <div className="home-dark-grid">
        <section className="home-dark-card">
          <div className="home-dark-section-head">
            <div>
              <span className="home-dark-kicker">Il prossimo appuntamento</span>
              <h2>Il tuo match</h2>
            </div>
            <Link to="/profilo" className="home-dark-more">
              I tuoi impegni <ArrowRight size={15} />
            </Link>
          </div>

          {myRegs.loading ? (
            <Spinner label="Caricamento del prossimo match…" />
          ) : next ? (
            <Link to={`/match/${next.match.id}`} className="home-dark-next">
              <span className="home-dark-next-icon">
                <CalendarDays size={22} />
              </span>
              <span className="home-dark-next-copy">
                <strong>{next.match.title}</strong>
                <small>
                  {formatDateShort(next.match.startsAt)} · {next.match.time} · {next.match.gym}
                </small>
              </span>
              <span className={`home-dark-status ${registrationTone(next.reg)}`}>
                {registrationLabel(next.reg)}
              </span>
            </Link>
          ) : (
            <div className="home-dark-empty">
              <TrophyIcon />
              <div>
                <strong>Nessun match in agenda</strong>
                <p>Iscriviti a un match aperto: se è pieno entri in lista riserva.</p>
              </div>
              <Link to="/match" className="home-dark-inline-link">
                Cerca <ArrowRight size={14} />
              </Link>
            </div>
          )}
        </section>

        <section className="home-dark-card">
          <div className="home-dark-section-head">
            <div>
              <span className="home-dark-kicker">Sempre a portata</span>
              <h2>Community</h2>
            </div>
          </div>
          <div className="home-dark-links">
            <Link to="/chat?focus=1" className="home-dark-link">
              <span className="home-dark-link-icon">
                <MessageCircle size={19} />
              </span>
              <span>
                <strong>Chat generale</strong>
                <small>Proposte match, ricerche e community</small>
              </span>
              <ArrowRight size={16} />
            </Link>
            <Link to="/gruppi" className="home-dark-link">
              <span className="home-dark-link-icon">
                <Users size={19} />
              </span>
              <span>
                <strong>Gruppi</strong>
                <small>Pubblici o privati, con chat dedicata</small>
              </span>
              <ArrowRight size={16} />
            </Link>
            <Link to="/profilo" className="home-dark-link">
              <span className="home-dark-link-icon">
                <UserRound size={19} />
              </span>
              <span>
                <strong>Profilo</strong>
                <small>Nickname, dati e verifica</small>
              </span>
              <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </div>

      <section className="home-dark-card">
        <div className="home-dark-section-head">
          <div>
            <span className="home-dark-kicker">Prossime partite</span>
            <h2>Match aperti</h2>
          </div>
          <Link to="/match" className="home-dark-more">
            Vedi tutti <ArrowRight size={15} />
          </Link>
        </div>

        {matchesState.loading ? (
          <Spinner label="Caricamento match…" />
        ) : upcoming.length === 0 ? (
          <div className="home-dark-empty">
            <span className="home-dark-empty-icon">
              <ClipboardList size={22} />
            </span>
            <div>
              <strong>Nessun match in programma</strong>
              <p>Pubblica il primo match e invita la community.</p>
            </div>
            <Link to="/match/nuovo" className="home-dark-inline-link">
              Crea <ArrowRight size={14} />
            </Link>
          </div>
        ) : (
          <div className="home-dark-match-list">
            {upcoming.slice(0, 4).map((row) => {
              const match = { id: row.id, ...row.data };
              const myReg = regMap.get(match.id);
              const full = (match.confirmedCount || 0) >= match.maxPlayers;
              return (
                <Link key={match.id} to={`/match/${match.id}`} className="home-dark-match">
                  <span className="home-dark-match-main">
                    <strong>{match.title}</strong>
                    <small>
                      {formatDateShort(match.startsAt)} · {match.time} · {match.gym}
                    </small>
                  </span>
                  <span className={`home-dark-status ${registrationTone(myReg)}`}>
                    {myReg ? registrationLabel(myReg) : full ? 'Pieno' : 'Posti liberi'}
                  </span>
                  <ArrowRight size={16} />
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function TrophyIcon() {
  return (
    <span className="home-dark-empty-icon">
      <CalendarDays size={22} />
    </span>
  );
}
