import { useState } from 'react';
import { Link2, Lock, MessageCircle } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { joinGroupByCode } from '../services/groups';
import { useToast } from './Toast';

export function PrivateGroupGate({
  title = 'Hai un invito?',
  subtitle = 'I gruppi privati non compaiono nell’elenco. Inserisci il codice ricevuto da un amico oppure apri il link diretto che ti ha condiviso.',
  pending = false,
  onUnlocked,
}) {
  const { uid, nickname } = useAuth();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    try {
      const result = await joinGroupByCode({ code, user: { uid, nickname } });
      toast.success('Gruppo sbloccato: benvenuto!');
      setCode('');
      onUnlocked?.(result.groupId);
    } catch (error) {
      toast.error(
        error?.code === 'permission-denied'
          ? 'Codice invito non valido o gruppo non accessibile.'
          : error.message
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card card-pad private-gate">
      <span className="private-gate-icon">
        <Lock size={25} />
      </span>
      <div className="private-gate-copy">
        <h2>{title}</h2>
        <p className="muted">{subtitle}</p>
        {pending ? (
          <p className="private-gate-note">
            La tua richiesta è in attesa, ma puoi sbloccare subito il gruppo con un codice invito.
          </p>
        ) : null}
        <form className="private-gate-form" onSubmit={submit}>
          <input
            className="input"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Codice invito, es. VOLLEY-ABC123"
            aria-label="Codice invito"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="btn btn-whatsapp" disabled={busy || !code.trim()}>
            <MessageCircle size={16} />
            {busy ? 'Apertura…' : 'Sblocca e entra'}
          </button>
        </form>
        <p className="hint private-gate-hint">
          <Link2 size={14} /> Oppure clicca il link diretto che ti ha inviato un amico.
        </p>
      </div>
    </section>
  );
}
