import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { ChatRoom } from '../components/ChatRoom';
import { generalChatPath } from '../services/chat';

export function Chat() {
  const { uid, nickname, profile, isAdmin, isBanned, isSilenced } = useAuth();

  return (
    <div className="page chat-page chat-page--full">
      <section className="card chat-card chat-card--full">
        <header className="chat-head chat-head--compact chat-head--general">
          <Link to="/" className="chat-head-back" aria-label="Torna alla Home">
            <ChevronLeft size={22} />
          </Link>
          <div className="chat-head-title">
            <strong>#generale</strong>
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
    </div>
  );
}
