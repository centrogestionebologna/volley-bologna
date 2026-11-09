import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Lock, Plus, Users } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { useSubscription } from '../lib/hooks';
import { store } from '../backend';
import { createGroup, getMembership } from '../services/groups';
import { PrivateGroupGate } from '../components/PrivateGroupGate';
import { Chip, EmptyState, Field, Modal, PageHead, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';

function GroupCard({ group, isMember }) {
  return (
    <Link
      to={`/gruppi/${group.id}${isMember ? '?focus=1' : ''}`}
      className="group-card"
    >
      <div className="group-card-head">
        <span className={`group-icon ${group.visibility === 'private' ? 'private' : ''}`}>
          {group.visibility === 'private' ? <Lock size={18} /> : <Users size={18} />}
        </span>
        <Chip tone={group.visibility === 'private' ? 'amber' : 'green'}>
          {group.visibility === 'private' ? 'Privato' : 'Pubblico'}
        </Chip>
      </div>
      <h3>{group.name}</h3>
      <p>{group.description || 'Nessuna descrizione.'}</p>
      <div className="group-card-foot">
        <span>
          <Users size={14} /> {group.memberCount || 1} membri
        </span>
        <span>
          {isMember ? 'Apri chat' : `di ${group.ownerNickname || '—'}`} <ArrowRight size={14} />
        </span>
      </div>
    </Link>
  );
}

export function Groups() {
  const { uid, nickname } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [visibilityFilter, setVisibilityFilter] = useState('public');
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [busy, setBusy] = useState(false);
  const [memberships, setMemberships] = useState({});
  const [membershipsLoading, setMembershipsLoading] = useState(true);

  const state = useSubscription(
    (cb) => store.subscribeList('groups', { orderBy: [['createdAt', 'desc']], limit: 100 }, cb),
    []
  );

  const groups = (state.data || []).map((row) => ({ id: row.id, ...row.data }));
  const publicGroups = groups.filter((group) => group.visibility !== 'private');
  const privateGroups = groups.filter(
    (group) => group.visibility === 'private' && memberships[group.id] === 'active'
  );

  useEffect(() => {
    if (!uid) {
      setMembershipsLoading(false);
      return undefined;
    }

    let active = true;
    const rows = state.data || [];
    setMembershipsLoading(true);

    Promise.all(
      rows.map(async (row) => {
        try {
          const membership = await getMembership(row.id, uid);
          return [row.id, membership?.data?.status || null];
        } catch {
          return [row.id, null];
        }
      })
    )
      .then((entries) => {
        if (active) setMemberships(Object.fromEntries(entries));
      })
      .finally(() => {
        if (active) setMembershipsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [uid, state.data]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await createGroup({ name, description, visibility, owner: { uid, nickname } });
      toast.success(
        visibility === 'private'
          ? 'Gruppo privato creato: condividi il codice invito dalla sezione Membri.'
          : 'Gruppo creato!'
      );
      setModalOpen(false);
      setName('');
      setDescription('');
      setVisibility('public');
      navigate(`/gruppi/${result.id}${visibility === 'private' ? '?tab=membri' : ''}`);
    } catch (error) {
      toast.error(
        error?.code === 'permission-denied'
          ? 'Permessi Firestore negati: pubblica le regole aggiornate e riprova.'
          : error.message
      );
    } finally {
      setBusy(false);
    }
  };

  const loading = state.loading || membershipsLoading;
  const visibleGroups = visibilityFilter === 'private' ? privateGroups : publicGroups;

  return (
    <div className="page">
      <PageHead
        eyebrow="Community"
        title="Gruppi"
        sub="Gruppi pubblici per tutti. I privati si aprono solo con un codice o un link invito."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)}>
            <Plus size={17} /> Nuovo gruppo
          </button>
        }
      />

      <div className="segmented">
        {[
          ['public', 'Pubblici'],
          ['private', 'Privati'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={visibilityFilter === value ? 'active' : ''}
            onClick={() => setVisibilityFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : visibilityFilter === 'private' ? (
        <>
          <PrivateGroupGate
            title="Hai un invito?"
            subtitle="I gruppi privati non sono elencati. Inserisci il codice ricevuto da un amico oppure apri il link diretto che ti ha condiviso: solo così puoi sbloccare il gruppo ed entrarci."
            onUnlocked={(groupId) => navigate(`/gruppi/${groupId}?focus=1`)}
          />

          <div className="private-groups-head">
            <div>
              <h2>I tuoi gruppi privati</h2>
              <p className="muted small">
                Restano qui dopo il primo accesso. Puoi sempre inserire un nuovo codice qui sopra.
              </p>
            </div>
            <Chip tone="amber">{privateGroups.length}</Chip>
          </div>

          {privateGroups.length === 0 ? (
            <EmptyState
              icon={Lock}
              title="Nessun gruppo privato sbloccato"
              text="Quando entri con un codice o un link invito, il gruppo resta visibile in questa sezione."
            />
          ) : (
            <div className="group-grid">
              {privateGroups.map((group) => (
                <GroupCard key={group.id} group={group} isMember />
              ))}
            </div>
          )}
        </>
      ) : visibleGroups.length === 0 ? (
        <EmptyState icon={Users} title="Nessun gruppo pubblico" text="Crea il primo gruppo della community.">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setModalOpen(true)}>
            Crea gruppo
          </button>
        </EmptyState>
      ) : (
        <div className="group-grid">
          {visibleGroups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              isMember={memberships[group.id] === 'active'}
            />
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Crea un gruppo"
        subtitle="I gruppi pubblici sono subito accessibili. I privati non sono elencati: si entra solo con codice o link invito."
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)}>
              Annulla
            </button>
            <button type="submit" form="group-form" className="btn btn-primary" disabled={busy || name.trim().length < 3}>
              Crea gruppo
            </button>
          </>
        }
      >
        <form id="group-form" onSubmit={submit} className="form">
          <Field label="Nome del gruppo *">
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Volley Bologna — tutti i livelli"
              required
              minLength={3}
              maxLength={80}
            />
          </Field>
          <Field label="Descrizione">
            <textarea
              className="textarea"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Di cosa si parla? Livello, zona, orari…"
              maxLength={400}
            />
          </Field>
          <Field label="Visibilità">
            <div className="radio-cards">
              <label className={visibility === 'public' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="visibility"
                  value="public"
                  checked={visibility === 'public'}
                  onChange={() => setVisibility('public')}
                />
                <strong>Pubblico</strong>
                <small>Chiunque può entrare subito.</small>
              </label>
              <label className={visibility === 'private' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="visibility"
                  value="private"
                  checked={visibility === 'private'}
                  onChange={() => setVisibility('private')}
                />
                <strong>Privato</strong>
                <small>Visibile solo con codice o link invito.</small>
              </label>
            </div>
          </Field>
        </form>
      </Modal>
    </div>
  );
}
