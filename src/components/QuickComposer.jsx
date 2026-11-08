import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronDown, Home, Loader2, Send, Users } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { store } from '../backend';
import { useSubscription } from '../lib/hooks';
import { LIMITS } from '../config';
import { generalChatPath, groupChatPath, sendMessage } from '../services/chat';
import { subscribeModerationSettings } from '../services/moderation';
import { useToast } from './Toast';

export function QuickComposer() {
  const { uid, nickname, profile, isBanned, isSilenced } = useAuth();
  const toast = useToast();
  const [target, setTarget] = useState('general');
  const [targets, setTargets] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const settings = useSubscription((cb) => subscribeModerationSettings(cb), []);
  const bannedWords = settings.data?.bannedWords || [];

  const groupsState = useSubscription(
    (cb) => store.subscribeList('groups', { orderBy: [['name', 'asc']], limit: 50 }, cb),
    []
  );
  const groups = useMemo(() => groupsState.data || [], [groupsState.data]);

  useEffect(() => {
    if (!uid) {
      setTargets([]);
      return undefined;
    }

    let active = true;

    Promise.all(
      groups.map(async (row) => {
        try {
          const membership = await store.getDoc(`groups/${row.id}/members/${uid}`);
          if (membership?.data?.status !== 'active') return null;
          return { id: row.id, name: row.data.name || 'Gruppo senza nome' };
        } catch {
          return null;
        }
      })
    ).then((rows) => {
      if (active) setTargets(rows.filter(Boolean));
    });

    return () => {
      active = false;
    };
  }, [uid, groups]);

  useEffect(() => {
    if (target !== 'general' && !targets.some((group) => group.id === target)) {
      setTarget('general');
    }
  }, [target, targets]);

  const selectedGroup = useMemo(
    () => targets.find((group) => group.id === target) || null,
    [target, targets]
  );
  const targetLabel = target === 'general' ? 'Generale' : selectedGroup?.name || 'Gruppo';
  const chatLabel = target === 'general' ? '#generale' : targetLabel;
  const canWrite = !isBanned && !isSilenced;

  const submit = async (event) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || !canWrite || sending || !uid) return;

    setSending(true);
    try {
      await sendMessage({
        path: target === 'general' ? generalChatPath : groupChatPath(target),
        author: { uid, nickname: profile?.nickname || nickname },
        text: value,
        bannedWords,
      });
      setText('');
      toast.success(`Messaggio inviato in ${chatLabel}.`);
    } catch (error) {
      toast.error(error.message || 'Impossibile inviare il messaggio.');
    } finally {
      setSending(false);
    }
  };

  const placeholder = !canWrite
    ? isBanned
      ? 'Account sospeso: non puoi scrivere'
      : 'Sei in silenzio temporaneo'
    : `Scrivi in ${chatLabel}…`;

  return (
    <nav className="bottom-nav" aria-label="Messaggio rapido">
      <form className="quick-composer" onSubmit={submit}>
        <div className={`quick-field ${canWrite ? '' : 'is-disabled'}`}>
          <textarea
            className="quick-input"
            rows={1}
            value={text}
            maxLength={LIMITS.maxMessageLength}
            placeholder={placeholder}
            aria-label={placeholder}
            disabled={!canWrite}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit(event);
              }
            }}
          />
          <button
            type="submit"
            className="quick-send"
            disabled={!canWrite || !text.trim() || sending}
            aria-label="Invia messaggio"
            title="Invia"
          >
            {sending ? <Loader2 size={17} className="spin" /> : <Send size={17} />}
          </button>
        </div>

        <label className="quick-target" title={`Destinazione: ${targetLabel}`}>
          <Users size={15} aria-hidden />
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            aria-label="Scegli dove scrivere"
          >
            <option value="general">Generale</option>
            {targets.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
          <ChevronDown size={13} aria-hidden />
        </label>

        <NavLink
          to="/"
          end
          className={({ isActive }) => `quick-home ${isActive ? 'active' : ''}`}
          aria-label="Vai alla Home"
          title="Home"
        >
          <Home size={18} />
        </NavLink>
      </form>
    </nav>
  );
}
