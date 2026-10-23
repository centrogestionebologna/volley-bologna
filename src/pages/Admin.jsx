import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  BadgeCheck,
  ClipboardList,
  Flag,
  Gavel,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  Trash2,
  UserRound,
  Users,
  VolumeX,
  X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { store } from '../backend';
import { useAsync, useSubscription } from '../lib/hooks';
import { formatDateTime, formatDateShort, toDate } from '../lib/format';
import {
  approveVerification,
  banUser,
  getModerationSettings,
  listDisputes,
  requestVerificationFromUser,
  resolveReport,
  saveBannedWords,
  setAdminRole,
  silenceUser,
  unbanUser,
} from '../services/moderation';
import { deleteMessage } from '../services/chat';
import { runScheduledMaintenance } from '../services/maintenance';
import { Avatar, Chip, EmptyState, Field, Modal, PageHead, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';

const TABS = [
  { id: 'overview', label: 'Panoramica', icon: Shield },
  { id: 'reports', label: 'Segnalazioni', icon: Flag },
  { id: 'users', label: 'Utenti', icon: Users },
  { id: 'words', label: 'Parole vietate', icon: MessageSquare },
  { id: 'disputes', label: 'Contestazioni', icon: Gavel },
];

function StatCard({ icon: Icon, value, label, tone = '' }) {
  return (
    <div className={`stat-card ${tone}`}>
      <Icon size={20} />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function OverviewTab({ onGoTo, toast }) {
  const stats = useAsync(async () => {
    const [users, matches, groups, openReports, disputes] = await Promise.all([
      store.count('users'),
      store.count('matches'),
      store.count('groups'),
      store.count('reports', { where: [['status', '==', 'open']] }),
      store.count('disputes'),
    ]);
    return { users, matches, groups, openReports, disputes };
  }, []);

  const verification = useSubscription(
    (cb) =>
      store.subscribeList(
        'users',
        {
          where: [['verificationStatus', 'in', ['requested', 'submitted']]],
          orderBy: [['updatedAt', 'desc']],
          limit: 30,
        },
        cb
      ),
    []
  );

  const [busy, setBusy] = useState(false);
  const [lastRun, setLastRun] = useState(null);

  const runMaintenance = async () => {
    setBusy(true);
    try {
      const result = await runScheduledMaintenance(store);
      setLastRun(result);
      toast.success(
        `Manutenzione eseguita: ${result.pendingOffers} riserve aggiornate, ${result.messagesDeleted} messaggi eliminati, ${result.createdMatches} match pubblicati.`
      );
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const approve = async (user) => {
    try {
      await approveVerification(user.id);
      toast.success(`${user.data.nickname} verificato.`);
    } catch (error) {
      toast.error(error.message);
    }
  };

  return (
    <div className="admin-tab">
      <div className="stats-grid">
        <StatCard icon={Users} value={stats.data?.users ?? '—'} label="utenti registrati" />
        <StatCard icon={ClipboardList} value={stats.data?.matches ?? '—'} label="match totali" />
        <StatCard icon={Users} value={stats.data?.groups ?? '—'} label="gruppi" />
        <StatCard icon={Flag} value={stats.data?.openReports ?? '—'} label="segnalazioni aperte" tone="warn" />
        <StatCard icon={Gavel} value={stats.data?.disputes ?? '—'} label="contestazioni" />
      </div>

      <div className="admin-grid">
        <section className="card card-pad">
          <div className="section-head">
            <h2>Richieste di verifica</h2>
            <Chip tone="amber">{verification.data?.length || 0}</Chip>
          </div>
          {(verification.data || []).length === 0 ? (
            <EmptyState icon={BadgeCheck} title="Nessuna richiesta" text="Tutte le identità sono in ordine." />
          ) : (
            <ul className="member-list">
              {verification.data.map((user) => (
                <li key={user.id}>
                  <Avatar name={user.data.nickname} size="sm" />
                  <div>
                    <strong>{user.data.nickname}</strong>
                    <small>
                      {user.data.realName} {user.data.surname} · {user.data.phone || 'telefono non indicato'}
                    </small>
                    <small>{user.data.email}</small>
                  </div>
                  <Chip tone={user.data.verificationStatus === 'requested' ? 'amber' : 'blue'}>
                    {user.data.verificationStatus === 'requested' ? 'Richiesta inviata' : 'Dati inviati'}
                  </Chip>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => approve(user)}>
                    <BadgeCheck size={14} /> Verifica
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card card-pad">
          <div className="section-head">
            <h2>Manutenzione automatica</h2>
          </div>
          <p className="small muted">
            Il cron Cloudflare esegue queste operazioni ogni 10 minuti. Puoi forzarle anche da qui:
            offerte riserve scadute, messaggi più vecchi di 30 giorni, pubblicazione delle ricorrenze.
          </p>
          <button type="button" className="btn btn-primary" onClick={runMaintenance} disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} Esegui ora
          </button>
          {lastRun ? (
            <p className="hint">
              Riserve aggiornate: {lastRun.pendingOffers} · messaggi eliminati: {lastRun.messagesDeleted} ·
              match creati: {lastRun.createdMatches}
            </p>
          ) : null}
          <div className="admin-quick">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onGoTo('reports')}>
              <Flag size={14} /> Segnalazioni
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onGoTo('words')}>
              <MessageSquare size={14} /> Parole vietate
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function ReportRow({ report, onChanged }) {
  const toast = useToast();
  const { uid } = useAuth();
  const [busy, setBusy] = useState('');
  const [details, setDetails] = useState(null);
  const target = useAsync(() => store.getDoc(`users/${report.targetUserId}`), [report.targetUserId]);
  const targetData = target.data?.data;

  const act = async (key, action, message) => {
    setBusy(key);
    try {
      await action();
      if (message) toast.success(message);
      onChanged?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <li className={`report-row ${report.status}`}>
      <div className="report-head">
        <Chip tone={report.status === 'open' ? 'amber' : 'green'}>
          {report.status === 'open' ? 'Aperta' : 'Risolta'}
        </Chip>
        <Chip tone="muted">{report.type === 'message' ? 'Messaggio' : report.type === 'irregularity' ? 'Irregolarità' : 'Utente'}</Chip>
        <span className="report-date">{formatDateTime(report.createdAt)}</span>
      </div>
      <p className="report-reason">{report.reason}</p>
      {report.messageText ? (
        <div className="report-quote">
          <strong>{report.targetNickname}</strong>
          <span>{report.messageText}</span>
        </div>
      ) : null}
      <div className="report-meta">
        Segnalato da <strong>{report.reporterNickname}</strong>
        {report.targetNickname ? (
          <>
            {' '}· utente <strong>{report.targetNickname}</strong>
          </>
        ) : null}
        {targetData ? (
          <>
            {' '}
            · {targetData.banned ? 'sospeso' : 'attivo'}
            {targetData.silencedUntil && toDate(targetData.silencedUntil)?.getTime() > Date.now()
              ? ' · silenziato'
              : ''}
          </>
        ) : null}
      </div>

      <div className="report-actions">
        {report.type === 'message' && report.chatPath && report.targetId ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy === 'delete'}
            onClick={() =>
              act(
                'delete',
                () => deleteMessage({ path: report.chatPath, messageId: report.targetId, deletedBy: uid }),
                'Messaggio eliminato.'
              )
            }
          >
            <Trash2 size={14} /> Elimina messaggio
          </button>
        ) : null}
        {report.targetUserId ? (
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy === 'silence'}
              onClick={() =>
                act('silence', () => silenceUser(report.targetUserId, 24, report.reason), 'Utente silenziato 24h.')
              }
            >
              <VolumeX size={14} /> Silenzia 24h
            </button>
            {targetData?.banned ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy === 'ban'}
                onClick={() => act('ban', () => unbanUser(report.targetUserId), 'Utente sbloccato.')}
              >
                <Ban size={14} /> Sblocca
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm danger-text"
                disabled={busy === 'ban'}
                onClick={() =>
                  act('ban', () => banUser(report.targetUserId, report.reason), 'Utente bannato.')
                }
              >
                <Ban size={14} /> Banna
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy === 'data'}
              onClick={async () => {
                setBusy('data');
                try {
                  const doc = await store.getDoc(`users/${report.targetUserId}`);
                  setDetails(doc?.data || null);
                } catch (error) {
                  toast.error(error.message);
                } finally {
                  setBusy('');
                }
              }}
            >
              <UserRound size={14} /> Dati
            </button>
          </>
        ) : null}
        {report.status === 'open' ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy === 'resolve'}
            onClick={() =>
              act('resolve', () => resolveReport(report.id, { resolution: 'Gestita dall’admin' }), 'Segnalazione chiusa.')
            }
          >
            Segna come risolta
          </button>
        ) : null}
      </div>

      <Modal open={Boolean(details)} onClose={() => setDetails(null)} title="Dati utente segnalato">
        {details ? (
          <div className="data-grid">
            <div>
              <small>Nickname</small>
              <strong>{details.nickname}</strong>
            </div>
            <div>
              <small>Nome e cognome</small>
              <strong>
                {details.realName} {details.surname}
              </strong>
            </div>
            <div>
              <small>Email</small>
              <strong>{details.email}</strong>
            </div>
            <div>
              <small>Telefono</small>
              <strong>{details.phone || '—'}</strong>
            </div>
            <div>
              <small>Verifica</small>
              <strong>{details.verificationStatus}</strong>
            </div>
          </div>
        ) : null}
      </Modal>
    </li>
  );
}

function ReportsTab() {
  const [status, setStatus] = useState('open');
  const state = useSubscription(
    (cb) =>
      store.subscribeList(
        'reports',
        { where: [['status', '==', status]], orderBy: [['createdAt', 'desc']], limit: 50 },
        cb
      ),
    [status]
  );

  return (
    <div className="admin-tab">
      <div className="segmented">
        <button type="button" className={status === 'open' ? 'active' : ''} onClick={() => setStatus('open')}>
          Aperte
        </button>
        <button type="button" className={status === 'resolved' ? 'active' : ''} onClick={() => setStatus('resolved')}>
          Risolte
        </button>
      </div>
      {state.loading ? (
        <Spinner />
      ) : (state.data || []).length === 0 ? (
        <EmptyState icon={Flag} title="Nessuna segnalazione" text="La community è tranquilla." />
      ) : (
        <ul className="report-list">
          {state.data.map((row) => (
            <ReportRow
              key={row.id}
              report={{ id: row.id, ...row.data }}
              onChanged={() => {}}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function UsersTab({ toast }) {
  const { uid } = useAuth();
  const [search, setSearch] = useState('');
  const state = useSubscription(
    (cb) => store.subscribeList('users', { orderBy: [['nickname', 'asc']], limit: 200 }, cb),
    []
  );
  const [busy, setBusy] = useState('');

  const users = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (state.data || []).filter((row) =>
      term
        ? `${row.data.nickname} ${row.data.realName} ${row.data.surname} ${row.data.email}`
            .toLowerCase()
            .includes(term)
        : true
    );
  }, [state.data, search]);

  const act = async (key, action, message) => {
    setBusy(key);
    try {
      await action();
      toast.success(message);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="admin-tab">
      <div className="search">
        <Search size={17} />
        <input
          type="search"
          placeholder="Cerca per nickname, nome o email…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {state.loading ? (
        <Spinner />
      ) : (
        <ul className="user-admin-list">
          {users.map((row) => {
            const user = row.data;
            const silenced = toDate(user.silencedUntil)?.getTime() > Date.now();
            return (
              <li key={row.id} className="user-admin-row">
                <Avatar name={user.nickname} size="sm" />
                <div className="user-admin-info">
                  <strong>
                    {user.nickname} {row.id === uid ? <span className="you-tag">tu</span> : null}
                  </strong>
                  <small>
                    {user.realName} {user.surname} · {user.email} · {user.phone || 'nessun telefono'}
                  </small>
                  <div className="user-flags">
                    {user.verified ? <Chip tone="green" icon={BadgeCheck}>Verificato</Chip> : null}
                    {user.banned ? <Chip tone="red" icon={Ban}>Bannato</Chip> : null}
                    {silenced ? <Chip tone="amber" icon={VolumeX}>Silenziato</Chip> : null}
                    <Chip tone="muted">{user.verificationStatus}</Chip>
                    <Chip tone="muted">dal {formatDateShort(user.createdAt)}</Chip>
                  </div>
                </div>
                <div className="user-admin-actions">
                  {user.verificationStatus !== 'verified' ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy === `req-${row.id}`}
                      onClick={() =>
                        act(
                          `req-${row.id}`,
                          () => requestVerificationFromUser(row.id),
                          'Verifica richiesta all’utente.'
                        )
                      }
                    >
                      Richiedi verifica
                    </button>
                  ) : null}
                  {user.verificationStatus === 'submitted' || user.verificationStatus === 'requested' ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busy === `ok-${row.id}`}
                      onClick={() => act(`ok-${row.id}`, () => approveVerification(row.id), 'Utente verificato.')}
                    >
                      Approva
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy === `sil-${row.id}`}
                    onClick={() => act(`sil-${row.id}`, () => silenceUser(row.id, 24, 'Decisione admin'), 'Utente silenziato 24h.')}
                  >
                    Silenzia 24h
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy === `sil7-${row.id}`}
                    onClick={() => act(`sil7-${row.id}`, () => silenceUser(row.id, 168, 'Decisione admin'), 'Utente silenziato 7 giorni.')}
                  >
                    7 giorni
                  </button>
                  {user.banned ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy === `ban-${row.id}`}
                      onClick={() => act(`ban-${row.id}`, () => unbanUser(row.id), 'Utente sbloccato.')}
                    >
                      Sblocca
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm danger-text"
                      disabled={busy === `ban-${row.id}` || row.id === uid}
                      onClick={() => {
                        if (!window.confirm(`Bannare ${user.nickname}?`)) return;
                        act(`ban-${row.id}`, () => banUser(row.id, 'Violazione delle regole'), 'Utente bannato.');
                      }}
                    >
                      Banna
                    </button>
                  )}
                  {row.id !== uid ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy === `adm-${row.id}`}
                      onClick={() => {
                        if (!window.confirm(`Rendere ${user.nickname} amministratore?`)) return;
                        act(`adm-${row.id}`, () => setAdminRole(row.id, true), 'Nuovo amministratore nominato.');
                      }}
                    >
                      <Shield size={13} /> Admin
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function WordsTab({ toast }) {
  const settings = useSubscription((cb) => store.subscribeDoc('settings/moderation', cb), []);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const words = settings.data?.data?.bannedWords || [];

  const save = async (next) => {
    setBusy(true);
    try {
      await saveBannedWords(next);
      toast.success('Lista parole aggiornata.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const add = async (event) => {
    event.preventDefault();
    const clean = value.trim().toLowerCase();
    if (!clean || words.includes(clean)) return;
    await save([...words, clean]);
    setValue('');
  };

  return (
    <div className="admin-tab">
      <div className="admin-grid">
        <section className="card card-pad">
          <div className="section-head">
            <h2>Parole vietate</h2>
            <Chip tone="amber">{words.length}</Chip>
          </div>
          <p className="small muted">
            Il filtro blocca il messaggio prima dell’invio (confronto senza accenti, per parola intera).
            Resta comunque possibile segnalare e rimuovere manualmente.
          </p>
          <form className="search-row" onSubmit={add}>
            <div className="search">
              <MessageSquare size={17} />
              <input
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="Aggiungi una parola…"
                maxLength={40}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
              <Plus size={16} /> Aggiungi
            </button>
          </form>
          <div className="word-chips">
            {words.length === 0 ? (
              <p className="small muted">Nessuna parola vietata configurata.</p>
            ) : (
              words.map((word) => (
                <span key={word} className="word-chip">
                  {word}
                  <button
                    type="button"
                    onClick={() => save(words.filter((item) => item !== word))}
                    aria-label={`Rimuovi ${word}`}
                    disabled={busy}
                  >
                    <X size={13} />
                  </button>
                </span>
              ))
            )}
          </div>
        </section>

        <section className="card card-pad">
          <h2 className="card-title">Suggerimenti</h2>
          <ul className="plain-list">
            <li>Inserisci insulti al singolare, senza punteggiatura.</li>
            <li>Le frasi con spazi funzionano come sequenza esatta.</li>
            <li>Il filtro non distingue maiuscole/minuscole né accenti.</li>
            <li>Le parole restano modificabili in qualsiasi momento.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

function DisputesTab() {
  const state = useAsync(() => listDisputes(), []);
  const [details, setDetails] = useState(null);
  const disputes = state.data || [];

  return (
    <div className="admin-tab">
      <div className="banner banner-warn">
        <ShieldAlert size={18} />
        <div>
          <strong>Contestazioni private</strong>
          <span>Non sono visibili agli utenti: solo amministrazione e organizzatore coinvolto.</span>
        </div>
      </div>
      {state.loading ? (
        <Spinner />
      ) : disputes.length === 0 ? (
        <EmptyState icon={Gavel} title="Nessuna contestazione" text="Nessun organizzatore ha aperto contestazioni." />
      ) : (
        <ul className="report-list">
          {disputes.map((row) => (
            <li key={row.id} className="report-row">
              <div className="report-head">
                <Chip tone="amber">Contestazione</Chip>
                <span className="report-date">{formatDateTime(row.data.createdAt)}</span>
              </div>
              <p className="report-reason">{row.data.description}</p>
              <div className="report-meta">
                Da <strong>{row.data.organizerNickname}</strong> su <strong>{row.data.targetNickname}</strong>
                {row.data.matchId ? ` · match ${row.data.matchId}` : ''}
              </div>
              <div className="report-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    const doc = await store.getDoc(`users/${row.data.targetUserId}`);
                    setDetails(doc?.data || null);
                  }}
                >
                  <UserRound size={14} /> Dati utente
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={Boolean(details)} onClose={() => setDetails(null)} title="Dati utente contestato">
        {details ? (
          <div className="data-grid">
            <div>
              <small>Nickname</small>
              <strong>{details.nickname}</strong>
            </div>
            <div>
              <small>Nome e cognome</small>
              <strong>
                {details.realName} {details.surname}
              </strong>
            </div>
            <div>
              <small>Email</small>
              <strong>{details.email}</strong>
            </div>
            <div>
              <small>Telefono</small>
              <strong>{details.phone || '—'}</strong>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

export function Admin() {
  const { isAdmin, nickname } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('overview');

  if (!isAdmin) {
    return (
      <div className="page page-narrow">
        <div className="access-denied big">
          <ShieldAlert size={30} />
          <div>
            <h2>Area riservata</h2>
            <p>Questa sezione è accessibile solo agli amministratori della community.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHead
        eyebrow={`Amministrazione · ${nickname}`}
        title="Dashboard"
        sub="Moderazione, utenti, parole vietate e contestazioni in un unico posto."
      />

      <div className="admin-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
          >
            <item.icon size={16} /> {item.label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? <OverviewTab onGoTo={setTab} toast={toast} /> : null}
      {tab === 'reports' ? <ReportsTab /> : null}
      {tab === 'users' ? <UsersTab toast={toast} /> : null}
      {tab === 'words' ? <WordsTab toast={toast} /> : null}
      {tab === 'disputes' ? <DisputesTab /> : null}
    </div>
  );
}
