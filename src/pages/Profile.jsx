import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BadgeCheck,
  Copy,
  Lock,
  LogOut,
  Mail,
  Phone,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserRound,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { store } from '../backend';
import { useAsync } from '../lib/hooks';
import { DEMO_ACCOUNTS } from '../demo/seed';
import {
  saveNickname,
  savePrivateData,
  savePublicData,
  submitVerification,
} from '../services/profiles';
import { listMyRegistrations } from '../services/matches';
import { Avatar, Chip, EmptyState, Field, PageHead, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { formatDateShort, formatDateTime, toDate } from '../lib/format';

export function Profile() {
  const { uid, user, profile, nickname, isAdmin, isDemo, signOut, signInDemo, refresh } = useAuth();
  const toast = useToast();

  const [nick, setNick] = useState(nickname);
  const [bio, setBio] = useState('');
  const [realName, setRealName] = useState('');
  const [surname, setSurname] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    setNick(profile?.nickname || nickname);
    setRealName(profile?.realName || '');
    setSurname(profile?.surname || '');
    setPhone(profile?.phone || '');
  }, [profile, nickname]);

  const publicProfile = useAsync(
    () => store.getDoc(`publicProfiles/${uid}`).then((doc) => doc?.data || null),
    [uid]
  );

  useEffect(() => {
    if (publicProfile.data?.bio) setBio(publicProfile.data.bio);
  }, [publicProfile.data]);

  const myMatches = useAsync(() => listMyRegistrations(uid), [uid]);
  const verification = profile?.verificationStatus || 'none';

  const savePublic = async () => {
    setBusy('public');
    try {
      await saveNickname(uid, nick);
      await savePublicData(uid, { bio });
      toast.success('Profilo pubblico aggiornato.');
      refresh();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  const savePrivate = async () => {
    setBusy('private');
    try {
      await savePrivateData(uid, { realName, surname, phone });
      toast.success('Dati privati salvati.');
      refresh();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  const requestVerification = async () => {
    if (!realName.trim() || !phone.trim()) {
      toast.error('Inserisci nome e telefono prima di richiedere la verifica.');
      return;
    }
    setBusy('verify');
    try {
      await submitVerification(uid);
      toast.success('Richiesta inviata: l’amministratore controllerà i dati.');
      refresh();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  const copyUid = async () => {
    try {
      await navigator.clipboard.writeText(uid);
      toast.success('ID copiato.');
    } catch {
      window.prompt('Il tuo ID utente:', uid);
    }
  };

  const resetDemo = async () => {
    if (!window.confirm('Ripristinare tutti i dati demo? Le modifiche locali andranno perse.')) return;
    await store.resetDemoData();
    await refresh();
    toast.success('Dati demo ripristinati.');
    window.location.reload();
  };

  const silenceUntil = toDate(profile?.silencedUntil);
  const isSilenced = Boolean(silenceUntil && silenceUntil.getTime() > Date.now());

  return (
    <div className="page">
      <PageHead
        eyebrow="Il tuo account"
        title="Profilo"
        sub="Il nickname è pubblico. Nome, cognome, email e telefono restano privati."
        actions={
          <button type="button" className="btn btn-ghost" onClick={signOut}>
            <LogOut size={16} /> Esci
          </button>
        }
      />

      <div className="profile-grid">
        <div className="profile-main">
          <section className="card profile-card">
            <Avatar name={nickname} src={profile?.photoURL || user?.photoURL} size="xl" />
            <div className="profile-card-info">
              <div className="profile-name-row">
                <h2>{nickname}</h2>
                {profile?.verified ? (
                  <Chip tone="green" icon={BadgeCheck}>
                    Verificato
                  </Chip>
                ) : (
                  <Chip tone="muted">Non verificato</Chip>
                )}
                {isAdmin ? <Chip tone="violet" icon={Shield}>Admin</Chip> : null}
              </div>
              <p>{publicProfile.data?.bio || 'Nessuna bio: raccontati in due righe.'}</p>
              <div className="profile-meta">
                <span>Dal {formatDateShort(profile?.createdAt)}</span>
                <span>
                  <Lock size={13} /> email privata
                </span>
              </div>
            </div>
          </section>

          {profile?.banned ? (
            <div className="access-denied">
              <ShieldCheck size={18} />
              <div>
                <strong>Account sospeso</strong>
                <p>{profile.banReason || 'Contatta l’amministrazione.'}</p>
              </div>
            </div>
          ) : null}

          {isSilenced ? (
            <div className="banner banner-warn">
              <ShieldCheck size={18} />
              <div>
                <strong>Silenzio temporaneo</strong>
                <span>Potrai scrivere in chat dal {formatDateTime(silenceUntil)}.</span>
              </div>
            </div>
          ) : null}

          <section className="card card-pad">
            <h2 className="card-title">
              <UserRound size={17} /> Profilo pubblico
            </h2>
            <div className="form">
              <Field label="Nickname pubblico" hint="È il nome che vedono tutti in chat, match e gruppi.">
                <input
                  className="input"
                  value={nick}
                  onChange={(event) => setNick(event.target.value)}
                  maxLength={24}
                  minLength={2}
                />
              </Field>
              <Field label="Bio" hint="Massimo 240 caratteri.">
                <textarea
                  className="textarea"
                  rows={3}
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  maxLength={240}
                  placeholder="Ruolo, livello, zona, giorni in cui giochi…"
                />
              </Field>
              <button type="button" className="btn btn-primary" onClick={savePublic} disabled={busy === 'public'}>
                Salva profilo pubblico
              </button>
            </div>
          </section>

          <section className="card card-pad">
            <h2 className="card-title">
              <Lock size={17} /> Dati privati
            </h2>
            <p className="privacy-note">
              Visibili solo a te e agli amministratori. Un organizzatore li vede <strong>solo</strong> se
              apre una segnalazione per irregolarità su un match, per 7 giorni.
            </p>
            <div className="form-row">
              <Field label="Nome">
                <input className="input" value={realName} onChange={(event) => setRealName(event.target.value)} />
              </Field>
              <Field label="Cognome">
                <input className="input" value={surname} onChange={(event) => setSurname(event.target.value)} />
              </Field>
            </div>
            <Field label="Numero di telefono" hint="Serve solo per essere contattato in caso di irregolarità.">
              <input
                className="input"
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+39 …"
              />
            </Field>
            <Field label="Email reale">
              <div className="readonly">
                <Mail size={15} /> {profile?.email || user?.email}
              </div>
            </Field>
            <button type="button" className="btn btn-primary" onClick={savePrivate} disabled={busy === 'private'}>
              Salva dati privati
            </button>
          </section>

          <section className="card card-pad">
            <h2 className="card-title">
              <Trophy size={17} /> I tuoi impegni
            </h2>
            {myMatches.loading ? (
              <Spinner />
            ) : (myMatches.data || []).length === 0 ? (
              <EmptyState
                icon={Trophy}
                title="Nessun match in agenda"
                text="Cerca un match aperto e iscriviti."
              >
                <Link to="/match" className="btn btn-ghost btn-sm">
                  Vai ai match
                </Link>
              </EmptyState>
            ) : (
              <ul className="compact-list">
                {myMatches.data.map(({ match, reg }) => (
                  <li key={match.id}>
                    <div>
                      <Link to={`/match/${match.id}`}>
                        <strong>{match.title}</strong>
                      </Link>
                      <small>
                        {formatDateTime(match.startsAt)} · {match.gym}
                      </small>
                    </div>
                    <Chip
                      tone={reg.status === 'confirmed' ? 'green' : reg.status === 'offered' ? 'amber' : 'blue'}
                    >
                      {reg.status === 'confirmed'
                        ? 'Iscritto'
                        : reg.status === 'offered'
                          ? 'Conferma il posto'
                          : 'In riserva'}
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="profile-side">
          <section className="card card-pad">
            <h2 className="card-title">
              <ShieldCheck size={17} /> Verifica identità
            </h2>
            {verification === 'verified' ? (
              <p className="small">
                <Chip tone="green" icon={BadgeCheck}>
                  Identità verificata
                </Chip>
                <br />
                I tuoi dati sono stati controllati dall’amministrazione.
              </p>
            ) : verification === 'submitted' ? (
              <p className="small muted">
                I tuoi dati sono in revisione. Ti avviseremo appena saranno approvati.
              </p>
            ) : (
              <>
                {verification === 'requested' ? (
                  <div className="banner banner-warn inline">
                    <Shield size={16} />
                    <span>L’admin ha richiesto una verifica manuale del tuo nome.</span>
                  </div>
                ) : null}
                <p className="small muted">
                  La verifica è manuale: un amministratore controlla nome, cognome e telefono. Serve per
                  evitare nomi falsi o profili sospetti.
                </p>
                {profile?.verificationNote ? <p className="hint">{profile.verificationNote}</p> : null}
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  onClick={requestVerification}
                  disabled={busy === 'verify'}
                >
                  <ShieldCheck size={16} /> Richiedi verifica
                </button>
              </>
            )}
          </section>

          <section className="card card-pad">
            <h2 className="card-title">
              <Phone size={17} /> Contatti e privacy
            </h2>
            <ul className="plain-list">
              <li>Email e telefono non compaiono mai nelle liste pubbliche.</li>
              <li>Gli organizzatori non possono cercarti per numero.</li>
              <li>Nessun pagamento è gestito dall’app.</li>
            </ul>
          </section>

          <section className="card card-pad">
            <h2 className="card-title">Account</h2>
            <p className="small muted">
              ID utente <code className="inline-code">{uid}</code>
            </p>
            <div className="row-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={copyUid}>
                <Copy size={14} /> Copia ID
              </button>
              {isAdmin ? (
                <Link to="/admin" className="btn btn-ghost btn-sm">
                  <Shield size={14} /> Admin
                </Link>
              ) : null}
            </div>
          </section>

          {isDemo ? (
            <section className="card card-pad">
              <h2 className="card-title">
                <Sparkles size={17} /> Account demo
              </h2>
              <div className="demo-switch">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.uid}
                    type="button"
                    className={`demo-switch-item ${account.uid === uid ? 'active' : ''}`}
                    onClick={() => signInDemo(account.uid)}
                    disabled={account.uid === uid}
                  >
                    <span>{account.name}</span>
                    <small>{account.role}</small>
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn-ghost btn-sm btn-block" onClick={resetDemo}>
                <RefreshCw size={14} /> Ripristina dati demo
              </button>
            </section>
          ) : null}

        </aside>
      </div>
    </div>
  );
}
