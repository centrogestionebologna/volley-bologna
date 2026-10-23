import { MessageCircle, ShieldCheck, Timer } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { ChatRoom } from '../components/ChatRoom';
import { Chip, PageHead } from '../components/ui';
import { generalChatPath } from '../services/chat';
import { LIMITS } from '../config';

export function Chat() {
  const { uid, nickname, profile, isAdmin, isBanned, isSilenced } = useAuth();

  return (
    <div className="page chat-page">
      <PageHead
        eyebrow="Community"
        title="Chat generale"
        sub="Il ritrovo di tutti i pallavolisti bolognesi: cerca compagni, organizza, chiacchiera."
      />

      <div className="chat-layout">
        <section className="card chat-card">
          <div className="chat-head">
            <div className="chat-head-title">
              <span className="chat-head-icon">
                <MessageCircle size={20} />
              </span>
              <div>
                <strong>#generale</strong>
                <small>Tutta la community · solo testo ed emoji</small>
              </div>
            </div>
            <div className="chat-head-meta">
              <Chip tone="blue" icon={Timer}>
                {LIMITS.messageRetentionDays} giorni
              </Chip>
              {isAdmin ? <Chip tone="violet">Moderatore</Chip> : null}
            </div>
          </div>
          <ChatRoom
            path={generalChatPath}
            currentUser={{ uid, nickname: profile?.nickname || nickname }}
            canWrite={!isBanned && !isSilenced}
            isModerator={isAdmin}
            disabledReason={
              isBanned
                ? 'Il tuo account è sospeso: non puoi scrivere in chat.'
                : 'Sei in silenzio temporaneo: potrai tornare a scrivere quando l’admin revoca la sanzione.'
            }
          />
        </section>

        <aside className="chat-side">
          <section className="card card-pad">
            <h2 className="card-title">
              <ShieldCheck size={17} /> Buona convivenza
            </h2>
            <ul className="plain-list">
              <li>Presentati con nickname, ruolo e livello.</li>
              <li>Per i match usa le iscrizioni, non la chat.</li>
              <li>Le parole vietate vengono bloccate prima dell’invio.</li>
              <li>Puoi segnalare un messaggio agli admin con la bandierina.</li>
              <li>I messaggi spariscono dopo {LIMITS.messageRetentionDays} giorni.</li>
            </ul>
          </section>
          <section className="card card-pad">
            <h2 className="card-title">Come funziona</h2>
            <p className="small muted">
              La chat è in tempo reale su Firestore. Gli admin possono eliminare qualsiasi messaggio,
              silenziare o bannare un utente. Le modifiche mostrano l’etichetta “Modificato”, le
              eliminazioni lasciano il segnaposto “Questo messaggio è stato eliminato”.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
