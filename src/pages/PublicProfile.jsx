import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, CalendarDays, ShieldAlert, UserRound } from 'lucide-react';
import { store } from '../backend';
import { useAsync } from '../lib/hooks';
import { Avatar, Chip, EmptyState, Spinner } from '../components/ui';
import { formatDateShort } from '../lib/format';

export function PublicProfile() {
  const { userId } = useParams();
  const state = useAsync(() => store.getDoc(`publicProfiles/${userId}`), [userId]);
  const profile = state.data?.data;

  if (state.loading) return <Spinner />;

  if (!profile) {
    return (
      <div className="page page-narrow">
        <EmptyState icon={ShieldAlert} title="Profilo non trovato" text="L’utente potrebbe non esistere più.">
          <Link to="/" className="btn btn-ghost">
            Torna alla home
          </Link>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      <Link to="/" className="back-link">
        <ArrowLeft size={15} /> Indietro
      </Link>

      <section className="card profile-card profile-card-public">
        <Avatar name={profile.nickname} src={profile.photoURL} size="xl" />
        <div className="profile-card-info">
          <div className="profile-name-row">
            <h1>{profile.nickname}</h1>
            {profile.verified ? (
              <Chip tone="green" icon={BadgeCheck}>
                Identità verificata
              </Chip>
            ) : null}
          </div>
          <p>{profile.bio || 'Questo giocatore non ha ancora scritto una bio.'}</p>
          <div className="profile-meta">
            <span>
              <CalendarDays size={13} /> Nella community dal {formatDateShort(profile.createdAt)}
            </span>
          </div>
        </div>
      </section>

      <section className="card card-pad">
        <h2 className="card-title">
          <UserRound size={17} /> Informazioni pubbliche
        </h2>
        <p className="small muted">
          Nome reale, email e telefono non sono pubblici. La reputazione è gestita privatamente dagli
          organizzatori dei match.
        </p>
      </section>
    </div>
  );
}
