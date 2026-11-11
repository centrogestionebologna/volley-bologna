import { useState } from 'react';
import { ChevronLeft, Loader2, Shield, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { ChatRoom } from '../components/ChatRoom';
import { Modal } from '../components/ui';
import { useToast } from '../components/Toast';
import { LIMITS } from '../config';
import { clearChatMessages, generalChatPath } from '../services/chat';

export function Chat() {
  const { uid, nickname, profile, isAdmin, isBanned, isSilenced } = useAuth();
  const toast = useToast();
  const [infoOpen, setInfoOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const clearGeneral = async () => {
    if (clearing) return;
    const ok = window.confirm(
      'Svuotare la chat generale? Tutti i messaggi verranno eliminati per tutti e non si potranno recuperare.'
    );
    if (!ok) return;
    setClearing(true);
    try {
      const removed = await clearChatMessages({ path: generalChatPath });
      toast.success(removed ? `${removed} messaggi eliminati.` : 'La chat era già vuota.');
      setInfoOpen(false);
    } catch (error) {
      toast.error(error.message || 'Impossibile svuotare la chat.');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="page chat-page chat-page--full">
      <section className="card chat-card chat-card--full">
        <header className="chat-head chat-head--compact chat-head--general">
          <Link to="/" className="chat-head-back" aria-label="Torna alla Home">
            <ChevronLeft size={22} />
          </Link>
          <div className="chat-head-title">
            <button
              type="button"
              className="chat-head-name chat-head-general-name"
              onClick={() => setInfoOpen(true)}
              title="Apri descrizione e impostazioni"
            >
              #generale
            </button>
          </div>
        </header>
        <ChatRoom
          path={generalChatPath}
          currentUser={{ uid, nickname: profile?.nickname || nickname }}
          canWrite={!isBanned && !isSilenced}
          isModerator={isAdmin}
          canClearChat={isAdmin}
          composerLabel="#generale"
          disabledReason={
            isBanned
              ? 'Il tuo account è sospeso: non puoi scrivere in chat.'
              : 'Sei in silenzio temporaneo: potrai tornare a scrivere quando l’admin revoca la sanzione.'
          }
        />
      </section>

      <Modal
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        title="#generale"
        subtitle="Chat pubblica della community"
        footer={
          <button type="button" className="btn btn-ghost" onClick={() => setInfoOpen(false)}>
            Chiudi
          </button>
        }
      >
        <div className="chat-info">
          <p className="muted">
            È lo spazio pubblico di Volley Bologna: proposte di match, ricerche di giocatori e
            conversazioni della community. Tutti gli utenti attivi possono partecipare.
          </p>

          <div className="chat-info-list">
            <div>
              <span>Visibilità</span>
              <strong>Pubblica</strong>
            </div>
            <div>
              <span>Scrittura</span>
              <strong>Tutti gli utenti attivi</strong>
            </div>
            <div>
              <span>Conservazione</span>
              <strong>{LIMITS.messageRetentionDays} giorni</strong>
            </div>
            <div>
              <span>Moderazione</span>
              <strong>Amministratori</strong>
            </div>
          </div>

          {isAdmin ? (
            <section className="chat-info-admin">
              <h3>
                <Shield size={16} /> Impostazioni admin
              </h3>
              <p className="muted small">
                Puoi eliminare qualsiasi messaggio o svuotare tutta la chat. L’operazione è
                definitiva per tutti.
              </p>
              <div className="chat-info-admin-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm chat-clear"
                  onClick={clearGeneral}
                  disabled={clearing}
                >
                  {clearing ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                  Svuota tutti i messaggi
                </button>
                <Link to="/admin" className="btn btn-ghost btn-sm" onClick={() => setInfoOpen(false)}>
                  Apri amministrazione
                </Link>
              </div>
            </section>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
