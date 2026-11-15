import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Chip } from './ui';
import { useToast } from './Toast';
import { useSubscription } from '../lib/hooks';
import { formatDateShort } from '../lib/format';
import {
  closePoll,
  deletePoll,
  retractVote,
  subscribePoll,
  subscribePollVotes,
  tallyVotes,
  votePoll,
} from '../services/polls';

function selectedLabelSuffix(vote, options) {
  if (!vote) return '';
  const index = Number(vote.optionIndex);
  return options[index] ? ' · hai votato: tocca di nuovo per togliere' : '';
}

/**
 * Scheda di un sondaggio con voti in tempo reale. Va bene sia nella chat del
 * gruppo (basta pollId) sia nell'elenco del pannello sondaggi (poll completo).
 */
export function PollCard({ groupId, poll: snapshot = null, pollId = null, uid, canManage = false }) {
  const toast = useToast();
  const id = snapshot?.id || pollId || '';
  const [busy, setBusy] = useState('');

  const liveState = useSubscription(
    (cb) => (!snapshot && pollId ? subscribePoll(groupId, pollId, cb) : () => {}),
    [groupId, pollId, Boolean(snapshot)]
  );
  const poll = snapshot || (liveState.data ? { id: liveState.data.id, ...liveState.data.data } : null);

  const votesState = useSubscription(
    (cb) => (id ? subscribePollVotes(groupId, id, cb) : () => {}),
    [groupId, id]
  );
  const votes = (votesState.data || []).map((row) => ({ id: row.id, ...row.data }));

  if (!poll) {
    if (snapshot || liveState.loading) return null;
    return <p className="poll-missing muted small">Sondaggio eliminato.</p>;
  }

  const options = poll.options || [];
  const counts = tallyVotes(votes, options.length);
  const total = counts.reduce((sum, value) => sum + value, 0);
  const myVote = votes.find((vote) => vote.uid === uid);
  const closed = poll.status === 'closed';

  const vote = async (index) => {
    if (!id || busy) return;
    setBusy(`vote-${id}`);
    try {
      await votePoll({ groupId, pollId: id, uid, optionIndex: index });
    } catch (error) {
      toast.error(error.message || 'Voto non registrato.');
    } finally {
      setBusy('');
    }
  };

  const retract = async () => {
    if (!id || busy) return;
    setBusy(`vote-${id}`);
    try {
      await retractVote({ groupId, pollId: id, uid });
      toast.success('Voto tolto.');
    } catch (error) {
      toast.error(error.message || 'Voto non rimosso.');
    } finally {
      setBusy('');
    }
  };

  const close = async () => {
    if (!id || busy) return;
    setBusy(`close-${id}`);
    try {
      await closePoll({ groupId, pollId: id, uid, question: poll.question });
      toast.success('Sondaggio chiuso.');
    } catch (error) {
      toast.error(error.message || 'Sondaggio non chiuso.');
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    if (!id || busy) return;
    if (!window.confirm('Eliminare questo sondaggio?')) return;
    setBusy(`delete-${id}`);
    try {
      await deletePoll({ groupId, pollId: id });
      toast.success('Sondaggio eliminato.');
    } catch (error) {
      toast.error(error.message || 'Sondaggio non eliminato.');
    } finally {
      setBusy('');
    }
  };

  return (
    <article className="poll-card">
      <div className="poll-head">
        <strong>{poll.question}</strong>
        <Chip tone={closed ? 'muted' : 'green'}>
          {closed ? 'Chiuso' : `${total} ${total === 1 ? 'voto' : 'voti'}`}
        </Chip>
      </div>
      <div className="poll-options">
        {options.map((option, index) => {
          const count = counts[index] || 0;
          const percent = total ? Math.round((count / total) * 100) : 0;
          const selected = myVote?.optionIndex === index;
          return (
            <button
              key={`${id}-${index}`}
              type="button"
              className={`poll-option ${selected ? 'selected' : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                if (selected) retract();
                else vote(index);
              }}
              disabled={closed || busy === `vote-${id}`}
              title={
                closed
                  ? 'Sondaggio chiuso'
                  : selected
                    ? 'Tocca di nuovo per togliere il voto'
                    : 'Vota questa opzione'
              }
            >
              <span className="poll-option-bar" style={{ width: `${percent}%` }} aria-hidden />
              <span className="poll-option-label">{option}</span>
              <span className="poll-option-count">{count} · {percent}%</span>
            </button>
          );
        })}
      </div>
      <div className="poll-foot">
        <small className="muted">
          {poll.createdByName || 'Membro'} · {formatDateShort(poll.createdAt)}
          {selectedLabelSuffix(myVote, options)}
        </small>
        {canManage ? (
          <div className="row-actions">
            {closed ? null : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={(event) => {
                  event.stopPropagation();
                  close();
                }}
                disabled={busy === `close-${id}`}
              >
                Chiudi
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm danger-text"
              onClick={(event) => {
                event.stopPropagation();
                remove();
              }}
              disabled={busy === `delete-${id}`}
            >
              <Trash2 size={14} /> Elimina
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
