import { Link } from 'react-router-dom';
import { Clock, Euro, MapPin, Users } from 'lucide-react';
import { AGE_BANDS, LEVELS, labelOf } from '../config';
import { toDate } from '../lib/format';
import { Chip } from './ui';

const MONTHS = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];

export function MatchCard({ match, myReg, compact = false }) {
  const start = toDate(match.startsAt);
  const confirmed = match.confirmedCount || 0;
  const waitlist = match.waitlistCount || 0;
  const full = confirmed >= match.maxPlayers;
  const seatOnHold = Boolean(match.pendingOffer) && !full;

  return (
    <Link to={`/match/${match.id}`} className={`match-card ${compact ? 'match-card-compact' : ''}`}>
      <div className="match-date">
        <strong>{start ? start.getDate() : '—'}</strong>
        <span>{start ? MONTHS[start.getMonth()] : ''}</span>
        <em>{start ? `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}` : ''}</em>
      </div>

      <div className="match-body">
        <div className="match-title-row">
          <h3>{match.title}</h3>
          {myReg ? (
            <Chip tone={myReg.status === 'confirmed' ? 'green' : myReg.status === 'offered' ? 'amber' : 'blue'}>
              {myReg.status === 'confirmed'
                ? 'Iscritto'
                : myReg.status === 'offered'
                  ? 'Posto riservato'
                  : 'In riserva'}
            </Chip>
          ) : full || seatOnHold ? (
            <Chip tone="amber">{full ? 'Pieno' : 'Posto in attesa'}</Chip>
          ) : (
            <Chip tone="green">Posti liberi</Chip>
          )}
        </div>

        <div className="match-meta">
          <span>
            <MapPin size={14} /> {match.gym}
            {match.zone ? ` · ${match.zone}` : ''}
          </span>
          <span>
            <Clock size={14} /> {match.time || (start ? start.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '')}
          </span>
        </div>

        <div className="match-tags">
          <Chip tone="blue">{labelOf(LEVELS, match.level)}</Chip>
          <Chip tone="violet">{labelOf(AGE_BANDS, match.ageBand)}</Chip>
          <Chip tone="muted" icon={Euro}>
            {Number(match.cost) ? `${match.cost} €` : 'Gratis'}
          </Chip>
          <Chip tone="muted" icon={Users}>
            {confirmed}/{match.maxPlayers}
          </Chip>
        </div>
      </div>

      <div className="match-side">
        <div className="match-progress">
          <div className="progress">
            <span style={{ width: `${Math.min(100, (confirmed / match.maxPlayers) * 100)}%` }} />
          </div>
          <small>
            {confirmed}/{match.maxPlayers} iscritti
            {waitlist > 0 ? ` · ${waitlist} in riserva` : ''}
          </small>
        </div>
        <span className="match-organizer">di {match.organizerNickname}</span>
      </div>
    </Link>
  );
}
