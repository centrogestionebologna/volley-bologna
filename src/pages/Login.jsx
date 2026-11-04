import { useState } from 'react';
import { Loader2, ShieldCheck, Users, Zap } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { APP_NAME } from '../config';
import { Logo } from '../components/Logo';

export function Login() {
  const { signIn, error } = useAuth();
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  const handleGoogle = async () => {
    setBusy(true);
    setLocalError('');
    try {
      await signIn();
    } catch (err) {
      setLocalError(err.message || 'Accesso non riuscito.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <section className="login-hero">
        <div className="login-brand">
          <span className="brand-mark brand-mark-lg">
            <Logo size={40} />
          </span>
          <div>
            <strong>Volley Bologna</strong>
            <span>Community</span>
          </div>
        </div>

        <div className="login-copy">
          <span className="eyebrow">La pallavolo bolognese, tutta in un posto</span>
          <h1>
            Trova il match.
            <br />
            Conosci la squadra.
            <br />
            <span>Entra in campo.</span>
          </h1>
          <p>
            Match organizzati, gruppi pubblici e privati, chat in tempo reale e una lista riserve che
            funziona davvero. Pensata per chi gioca, non per chi paga abbonamenti.
          </p>
          <ul className="login-points">
            <li>
              <Zap size={17} /> Iscrizioni con posti garantiti e riserve automatiche
            </li>
            <li>
              <Users size={17} /> Gruppi per livello, zona ed età
            </li>
            <li>
              <ShieldCheck size={17} /> Reputazione gestita dagli organizzatori
            </li>
          </ul>
        </div>

        <div className="login-stats">
          <div>
            <strong>1 mese</strong>
            <span>di chat, poi pulizia automatica</span>
          </div>
          <div>
            <strong>30 min</strong>
            <span>per confermare un posto da riserva</span>
          </div>
          <div>
            <strong>0 €</strong>
            <span>nessun pagamento nell’app</span>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <h2>Bentornato in campo</h2>
          <p className="muted">Accedi con Google per entrare in {APP_NAME}.</p>

          <button type="button" className="google-btn" onClick={handleGoogle} disabled={busy}>
            {busy ? (
              <Loader2 size={18} className="spin" />
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
                <path
                  fill="#4285F4"
                  d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.87Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.63H1.29a12 12 0 0 0 0 10.74l3.98-3.09Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44A11.96 11.96 0 0 0 12 0 12 12 0 0 0 1.29 6.63l3.98 3.09C6.22 6.87 8.87 4.75 12 4.75Z"
                />
              </svg>
            )}
            Continua con Google
          </button>

          {localError || error ? (
            <div className="login-error" role="alert">
              {localError || error}
            </div>
          ) : null}

          <div className="login-privacy">
            <ShieldCheck size={16} />
            <p>
              Nome, cognome, email e telefono restano <strong>privati</strong>. Sono visibili a te,
              all’amministrazione e all’organizzatore solo quando apre una segnalazione per
              irregolarità.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
