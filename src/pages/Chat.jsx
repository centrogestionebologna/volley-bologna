import { ChevronLeft, MessageCircle, Timer } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { ChatRoom } from '../components/ChatRoom';
import { Chip } from '../components/ui';
import { generalChatPath } from '../services/chat';
import { LIMITS } from '../config';

export function Chat() {
  const { uid, nickname, profile, isAdmin, isBanned, isSilenced } = useAuth();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const focusRequest = location.state?.focusRequest;

  return (
    <div className="page chat-page chat-page--full">
      <section className="card chat-card chat-card--full">
        <header className="chat-head chat-head--compact">
          <Link to="/" className="chat-head-back" aria-label="Torna alla Home">
            <ChevronLeft size={22} />
          </Link>
          <span className="chat-head-icon">
            <MessageCircle size={20} />
          </span>
          <div className="chat-head-title">
            <strong>#generale</strong>
            <small>Tutta la community · solo testo ed emoji</small>
          </div>
          <div className="chat-head-meta">
            <Chip tone="blue" icon={Timer}>
              {LIMITS.messageRetentionDays} giorni
            </Chip>
            {isAdmin ? <Chip tone="violet">Moderatore</Chip> : null}
          </div>
        </header>
        <ChatRoom
          path={generalChatPath}
          currentUser={{ uid, nickname: profile?.nickname || nickname }}
          canWrite={!isBanned && !isSilenced}
          isModerator={isAdmin}
          autoFocus={searchParams.get('focus') === '1'}
          focusRequest={focusRequest}
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
