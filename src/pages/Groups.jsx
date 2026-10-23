import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Lock, Plus, Users } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { useSubscription } from '../lib/hooks';
import { store } from '../backend';
import { createGroup } from '../services/groups';
import { Chip, EmptyState, Field, Modal, PageHead, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';

export function Groups() {
  const { uid, nickname } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [visibilityFilter, setVisibilityFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [busy, setBusy] = useState(false);

  const state = useSubscription(
    (cb) => store.subscribeList('groups', { orderBy: [['createdAt', 'desc']], limit: 100 }, cb),
    []
  );

  const groups = (state.data || [])
    .map((row) => ({ id: row.id, ...row.data }))
    .filter((group) => visibilityFilter === 'all' || group.visibility === visibilityFilter);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await createGroup({ name, description, visibility, owner: { uid, nickname } });
      toast.success('Gruppo creato!');
      setModalOpen(false);
      setName('');
      setDescription('');
      setVisibility('public');
      navigate(`/gruppi/${result.id}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHead
        eyebrow="Community"
        title="Gruppi"
        sub="Gruppi pubblici per tutti, gruppi privati su richiesta o con link invito."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)}>
            <Plus size={17} /> Nuovo gruppo
          </button>
        }
      />

      <div className="segmented">
        {[
          ['all', 'Tutti'],
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

      {state.loading ? (
        <Spinner />
      ) : groups.length === 0 ? (
        <EmptyState icon={Users} title="Nessun gruppo" text="Crea il primo gruppo della community.">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setModalOpen(true)}>
            Crea gruppo
          </button>
        </EmptyState>
      ) : (
        <div className="group-grid">
          {groups.map((group) => (
            <Link key={group.id} to={`/gruppi/${group.id}`} className="group-card">
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
                  di {group.ownerNickname || '—'} <ArrowRight size={14} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Crea un gruppo"
        subtitle="I gruppi pubblici sono subito accessibili. I privati richiedono approvazione o link invito."
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
                <small>Serve approvazione o link invito.</small>
              </label>
            </div>
          </Field>
        </form>
      </Modal>
    </div>
  );
}
