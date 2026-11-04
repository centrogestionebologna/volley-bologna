import { Database, KeyRound, Terminal } from 'lucide-react';
import { APP_NAME, LOGO_URL, missingFirebaseKeys } from '../config';

export function SetupScreen() {
  return (
    <div className="setup-screen">
      <div className="setup-card">
        <img className="setup-logo" src={LOGO_URL} alt="" width={72} height={72} />
        <span className="eyebrow">Configurazione necessaria</span>
        <h1>Collega {APP_NAME} a Firebase</h1>
        <p className="muted">
          L’app non ha più una modalità dimostrativa: senza un progetto Firebase non può leggere né
          salvare dati. Servono cinque minuti, una volta sola.
        </p>

        <div className="setup-missing">
          <strong>
            <KeyRound size={16} /> Variabili mancanti
          </strong>
          <ul>
            {missingFirebaseKeys.map((key) => (
              <li key={key}>
                <code>{key}</code>
              </li>
            ))}
          </ul>
        </div>

        <ol className="setup-steps">
          <li>
            Crea un progetto su <strong>console.firebase.google.com</strong> (piano Spark, gratuito).
          </li>
          <li>
            Attiva <strong>Authentication → Google</strong> e aggiungi <code>localhost</code> ai domini
            autorizzati.
          </li>
          <li>
            Crea il database <strong>Cloud Firestore</strong> in modalità production e pubblica regole e
            indici con <code>firebase deploy --only firestore:rules,firestore:indexes</code>.
          </li>
          <li>
            Copia <code>.env.example</code> in <code>.env.local</code> e compila le variabili con la
            configurazione dell’app web Firebase.
          </li>
          <li>
            Riavvia il dev server: <code>npm run dev</code>.
          </li>
        </ol>

        <p className="setup-foot">
          <Terminal size={15} /> Dopo il primo accesso serve un amministratore: crea il documento{' '}
          <code>admins/&lt;uid&gt;</code> in Firestore (vedi README, sezione “Primo admin”).
        </p>
        <p className="setup-foot">
          <Database size={15} /> Le regole di sicurezza e gli indici sono già nel repository.
        </p>
      </div>
    </div>
  );
}
