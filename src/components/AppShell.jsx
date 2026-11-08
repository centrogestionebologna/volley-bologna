import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  ChevronRight,
  ClipboardList,
  LogOut,
  MessageCircle,
  Shield,
  ShieldAlert,
  Sparkles,
  Users,
  Volleyball,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { Avatar, Chip } from './ui';
import { Logo } from './Logo';
import { Countdown } from './Countdown';
import { QuickComposer } from './QuickComposer';
import { formatDateTime } from '../lib/format';

const NAV = [
  { to: '/', label: 'Home', icon: CalendarDays, end: true },
  { to: '/match', label: 'Match', icon: ClipboardList },
  { to: '/gruppi', label: 'Gruppi', icon: Users },
  { to: '/chat', label: 'Chat', icon: MessageCircle },
  { to: '/organizzatore', label: 'Area organizer', icon: Sparkles },
];

export function AppShell() {
  const { nickname, profile, isAdmin, isBanned, offers, signOut, user } = useAuth();
  const navigate = useNavigate();
  const nextOffer = offers?.[0];

  return (
    <div className="app">
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <span className="brand-mark">
            <Logo size={34} />
          </span>
          <span className="brand-text">
            <strong>Volley Bologna</strong>
            <small>Community</small>
          </span>
        </NavLink>

        <nav className="nav" aria-label="Navigazione principale">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="nav-item">
              <item.icon size={19} />
              <span>{item.label}</span>
            </NavLink>
          ))}
          {isAdmin ? (
            <NavLink to="/admin" className="nav-item nav-admin">
              <Shield size={19} />
              <span>Amministrazione</span>
            </NavLink>
          ) : null}
        </nav>

        <div className="sidebar-foot">
          <NavLink to="/profilo" className="sidebar-user">
            <Avatar name={nickname} src={profile?.photoURL || user?.photoURL} size="sm" />
            <span>
              <strong>{nickname}</strong>
              <small>{isAdmin ? 'Amministratore' : 'Giocatore'}</small>
            </span>
            <ChevronRight size={16} />
          </NavLink>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <NavLink to="/" className="brand-mobile">
            <span className="brand-mark">
              <Volleyball size={18} strokeWidth={2} />
            </span>
            <strong>Volley Bologna</strong>
          </NavLink>
          <div className="topbar-center">
            {profile?.verified ? (
              <Chip tone="green" icon={Shield}>
                Verificato
              </Chip>
            ) : null}
          </div>
          <div className="topbar-right">
            <NavLink to="/profilo" className="topbar-user">
              <Avatar name={nickname} src={profile?.photoURL || user?.photoURL} size="xs" />
              <span>{nickname}</span>
            </NavLink>
            <button type="button" className="icon-btn" onClick={signOut} aria-label="Esci" title="Esci">
              <LogOut size={17} />
            </button>
          </div>
        </header>

        {nextOffer ? (
          <div className="offer-banner">
            <div>
              <strong>Hai un posto riservato! 🎉</strong>
              <span>
                {nextOffer.title} · {formatDateTime(nextOffer.startsAt)}
              </span>
            </div>
            <div className="offer-banner-actions">
              <Countdown expiresAt={nextOffer.pendingOffer?.expiresAt} compact />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => navigate(`/match/${nextOffer.id}`)}
              >
                Conferma
              </button>
            </div>
          </div>
        ) : null}

        {isBanned ? (
          <div className="banner banner-danger">
            <ShieldAlert size={18} />
            <div>
              <strong>Account sospeso</strong>
              <span>{profile?.banReason || 'Contatta un amministratore per maggiori informazioni.'}</span>
            </div>
          </div>
        ) : null}

        <main className="content">
          <Outlet />
        </main>
      </div>

      <QuickComposer />
    </div>
  );
}
