import { useEffect, useMemo, useRef, useState } from 'react';
import { Flag, Loader2, Pencil, Reply, Send, Smile, Trash2, X } from 'lucide-react';
import { Avatar, Modal } from './ui';
import { EmojiPicker } from './EmojiPicker';
import { useToast } from './Toast';
import { useSubscription } from '../lib/hooks';
import { formatDateShort, formatTime, toDate } from '../lib/format';
import { LIMITS } from '../config';
import {
  deleteMessage,
  editMessage,
  loadOlderMessages,
  sendMessage,
  subscribeMessages,
} from '../services/chat';
import { createReport, subscribeModerationSettings } from '../services/moderation';

function dayLabel(value) {
  const date = toDate(value);
  if (!date) return '';
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return 'Oggi';
  if (sameDay(date, yesterday)) return 'Ieri';
  return formatDateShort(date);
}

export function ChatRoom({ path, currentUser, canWrite, disabledReason, isModerator = false }) {
  const toast = useToast();
  const [live, setLive] = useState([]);
  const [older, setOlder] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [reportReason, setReportReason] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const stickRef = useRef(true);

  const settings = useSubscription(
    (cb) => subscribeModerationSettings(cb),
    []
  );
  const bannedWords = settings.data?.bannedWords || [];

  useEffect(() => {
    setOlder([]);
    setHasMore(true);
    setReplyTo(null);
    setEditing(null);
    setText('');
    return subscribeMessages(path, (rows) => setLive(rows));
  }, [path]);

  const messages = useMemo(() => {
    const seen = new Set();
    return [...older, ...live].filter((message) => {
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      return true;
    });
  }, [older, live]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (stickRef.current) body.scrollTop = body.scrollHeight;
  }, [messages.length]);

  const onScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    stickRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < 120;
  };

  const scrollToBottom = () => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
    stickRef.current = true;
  };

  const loadOlder = async () => {
    const first = messages[0];
    if (!first) return;
    setLoadingOlder(true);
    try {
      const rows = await loadOlderMessages(path, toDate(first.createdAt));
      if (rows.length < LIMITS.messagesPageSize) setHasMore(false);
      setOlder((prev) => [...rows.filter((row) => !prev.some((item) => item.id === row.id)), ...prev]);
      stickRef.current = false;
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoadingOlder(false);
    }
  };

  const startReply = (message) => {
    setReplyTo(message);
    setEditing(null);
    inputRef.current?.focus();
  };

  const startEdit = (message) => {
    setEditing(message);
    setReplyTo(null);
    setText(message.text);
    inputRef.current?.focus();
  };

  const cancelComposer = () => {
    setEditing(null);
    setReplyTo(null);
    setText('');
  };

  const submit = async (event) => {
    event?.preventDefault();
    if (!canWrite || sending) return;
    const value = text.trim();
    if (!value) return;
    setSending(true);
    try {
      if (editing) {
        await editMessage({ path, messageId: editing.id, text: value, bannedWords });
        toast.success('Messaggio modificato');
        cancelComposer();
      } else {
        await sendMessage({
          path,
          author: currentUser,
          text: value,
          replyTo,
          bannedWords,
        });
        setText('');
        setReplyTo(null);
        stickRef.current = true;
      }
    } catch (error) {
      toast.error(error.message || 'Impossibile inviare il messaggio.');
    } finally {
      setSending(false);
    }
  };

  const remove = async (message) => {
    if (!window.confirm('Eliminare questo messaggio? Comparirà come “Questo messaggio è stato eliminato”.')) {
      return;
    }
    try {
      await deleteMessage({ path, messageId: message.id, deletedBy: currentUser.uid });
      toast.success('Messaggio eliminato');
    } catch (error) {
      toast.error(error.message);
    }
  };

  const submitReport = async () => {
    if (!reportTarget) return;
    setReportBusy(true);
    try {
      await createReport({
        type: 'message',
        targetId: reportTarget.id,
        targetUserId: reportTarget.authorId,
        targetNickname: reportTarget.authorNickname,
        messageText: reportTarget.text,
        chatPath: path,
        reason: reportReason,
        reporter: currentUser,
      });
      toast.success('Segnalazione inviata agli amministratori');
      setReportTarget(null);
      setReportReason('');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setReportBusy(false);
    }
  };

  const addEmoji = (emoji) => {
    const input = inputRef.current;
    if (!input) {
      setText((prev) => prev + emoji);
      return;
    }
    const start = input.selectionStart ?? text.length;
    const end = input.selectionEnd ?? text.length;
    const next = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
    setText(next);
    requestAnimationFrame(() => {
      input.focus();
      input.selectionStart = start + emoji.length;
      input.selectionEnd = start + emoji.length;
    });
  };

  return (
    <div className="chat">
      <div className="chat-body" ref={bodyRef} onScroll={onScroll}>
        <div className="chat-top">
          {hasMore ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={loadOlder} disabled={loadingOlder}>
              {loadingOlder ? <Loader2 size={14} className="spin" /> : null}
              Carica messaggi precedenti
            </button>
          ) : (
            <span className="chat-start">
              Messaggi conservati per {LIMITS.messageRetentionDays} giorni
            </span>
          )}
        </div>

        {messages.length === 0 ? (
          <div className="chat-empty">
            <span>💬</span>
            <p>Nessun messaggio. Rompi il ghiaccio!</p>
          </div>
        ) : null}

        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const showDay =
            !previous || dayLabel(previous.createdAt) !== dayLabel(message.createdAt);
          const own = message.authorId === currentUser.uid;
          const canEdit = own && !message.deleted;
          const canDelete = (own || isModerator) && !message.deleted;

          return (
            <div key={message.id}>
              {showDay ? <div className="day-divider">{dayLabel(message.createdAt)}</div> : null}
              <div className={`msg ${own ? 'own' : ''}`}>
                {!own ? <Avatar name={message.authorNickname} size="sm" /> : null}
                <div className="msg-content">
                  {!own ? <span className="msg-author">{message.authorNickname}</span> : null}
                  <div className={`msg-bubble ${message.deleted ? 'deleted' : ''}`}>
                    {message.replyTo ? (
                      <div className="msg-quote">
                        <strong>{message.replyTo.nickname}</strong>
                        <span>{message.replyTo.text || 'Messaggio eliminato'}</span>
                      </div>
                    ) : null}
                    {message.deleted ? (
                      <p className="msg-deleted">Questo messaggio è stato eliminato</p>
                    ) : (
                      <p className="msg-text">{message.text}</p>
                    )}
                    <div className="msg-meta">
                      {message.editedAt && !message.deleted ? <span className="edited">Modificato</span> : null}
                      <time>{formatTime(message.createdAt)}</time>
                    </div>
                  </div>
                  <div className="msg-actions">
                    {canWrite && !message.deleted ? (
                      <button type="button" onClick={() => startReply(message)} aria-label="Rispondi" title="Rispondi">
                        <Reply size={14} />
                      </button>
                    ) : null}
                    {canEdit && canWrite ? (
                      <button type="button" onClick={() => startEdit(message)} aria-label="Modifica" title="Modifica">
                        <Pencil size={14} />
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button type="button" onClick={() => remove(message)} aria-label="Elimina" title="Elimina">
                        <Trash2 size={14} />
                      </button>
                    ) : null}
                    {!own && !message.deleted ? (
                      <button
                        type="button"
                        onClick={() => {
                          setReportTarget(message);
                          setReportReason('');
                        }}
                        aria-label="Segnala"
                        title="Segnala agli admin"
                      >
                        <Flag size={14} />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!canWrite ? (
        <div className="chat-disabled">{disabledReason || 'Non puoi scrivere in questa chat.'}</div>
      ) : (
        <form className="chat-input" onSubmit={submit}>
          {replyTo ? (
            <div className="composer-note reply">
              <div>
                <strong>Rispondi a {replyTo.authorNickname}</strong>
                <span>{replyTo.deleted ? 'Messaggio eliminato' : replyTo.text.slice(0, 120)}</span>
              </div>
              <button type="button" className="icon-btn" onClick={cancelComposer} aria-label="Annulla risposta">
                <X size={16} />
              </button>
            </div>
          ) : null}
          {editing ? (
            <div className="composer-note edit">
              <div>
                <strong>Modifica messaggio</strong>
                <span>{editing.text.slice(0, 120)}</span>
              </div>
              <button type="button" className="icon-btn" onClick={cancelComposer} aria-label="Annulla modifica">
                <X size={16} />
              </button>
            </div>
          ) : null}
          <div className="composer-row">
            <div className="emoji-anchor">
              <button
                type="button"
                className="icon-btn"
                onClick={() => setEmojiOpen((open) => !open)}
                aria-label="Emoji"
              >
                <Smile size={20} />
              </button>
              {emojiOpen ? (
                <EmojiPicker
                  onPick={(emoji) => {
                    addEmoji(emoji);
                  }}
                  onClose={() => setEmojiOpen(false)}
                />
              ) : null}
            </div>
            <textarea
              ref={inputRef}
              className="chat-textarea"
              rows={1}
              value={text}
              maxLength={LIMITS.maxMessageLength}
              placeholder={editing ? 'Modifica il messaggio…' : 'Scrivi un messaggio…'}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <button
              type="submit"
              className="send-btn"
              disabled={!text.trim() || sending}
              aria-label="Invia"
            >
              {sending ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
            </button>
          </div>
          <span className="composer-hint">
            Solo testo ed emoji · Invio per inviare, Maiusc+Invio per andare a capo
          </span>
        </form>
      )}

      <Modal
        open={Boolean(reportTarget)}
        onClose={() => setReportTarget(null)}
        title="Segnala messaggio"
        subtitle="La segnalazione è visibile solo agli amministratori."
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setReportTarget(null)}>
              Annulla
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={submitReport}
              disabled={!reportReason.trim() || reportBusy}
            >
              {reportBusy ? <Loader2 size={16} className="spin" /> : null} Invia segnalazione
            </button>
          </>
        }
      >
        <div className="report-quote">
          <strong>{reportTarget?.authorNickname}</strong>
          <span>{reportTarget?.text}</span>
        </div>
        <label className="field">
          <span className="field-label">Motivo</span>
          <textarea
            className="textarea"
            rows={3}
            value={reportReason}
            onChange={(event) => setReportReason(event.target.value)}
            placeholder="Spiega brevemente cosa non va…"
          />
        </label>
      </Modal>
    </div>
  );
}
