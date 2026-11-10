import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Home, Smile, Users } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { store } from '../backend';
import { useSubscription } from '../lib/hooks';
import { GroupWheel } from './GroupWheel';
import { useChatComposerDock } from './ChatComposerDock';

export function QuickComposer() {
  const { uid } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { active: composerActive, setSlot: setComposerSlot, wheelRequest } = useChatComposerDock();
  const routeGroupId = location.pathname.match(/^\/gruppi\/([^/]+)$/)?.[1] || '';
  const [target, setTarget] = useState(routeGroupId || 'general');
  const [targets, setTargets] = useState([]);
  const [wheelOpen, setWheelOpen] = useState(false);
  const dockRef = useRef(null);
  const navigateTimer = useRef(null);

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

  useEffect(() => {
    if (wheelRequest > 0) setWheelOpen(true);
  }, [wheelRequest]);

  useEffect(() => () => {
    if (navigateTimer.current) clearTimeout(navigateTimer.current);
  }, []);

  useEffect(() => {
    if (!wheelOpen) return undefined;
    const onPointerDown = (event) => {
      if (dockRef.current && !dockRef.current.contains(event.target)) setWheelOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setWheelOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [wheelOpen]);

  const items = useMemo(() => [{ id: 'general', name: 'Generale' }, ...targets], [targets]);
  const targetLabel = items.find((item) => item.id === target)?.name || 'Generale';
  const chatPath = target === 'general' ? '/chat?focus=1' : `/gruppi/${target}?focus=1`;

  useEffect(() => {
    const groupMatch = location.pathname.match(/^\/gruppi\/([^/]+)$/);
    if (groupMatch && targets.some((group) => group.id === groupMatch[1])) {
      setTarget(groupMatch[1]);
    } else if (location.pathname === '/chat') {
      setTarget('general');
    }
  }, [location.pathname, targets]);

  const chatPathFor = useCallback(
    (id) => (id === 'general' ? '/chat?chat=1' : `/gruppi/${id}?chat=1`),
    []
  );

  const selectTarget = useCallback(
    (id) => {
      setTarget(id);
      if (navigateTimer.current) clearTimeout(navigateTimer.current);
      navigateTimer.current = setTimeout(() => {
        navigate(chatPathFor(id), { replace: true });
      }, 320);
    },
    [chatPathFor, navigate]
  );

  const openChat = () => {
    setWheelOpen(false);
    // Apre solo la conversazione: la tastiera parte quando l'utente
    // tocca di nuovo la barra ormai diventata composer.
    navigate(chatPath);
  };

  return (
    <nav className="bottom-nav" aria-label="Chat rapida" ref={dockRef}>
      <div className="quick-composer">
        <div
          ref={setComposerSlot}
          className={`quick-composer-slot ${composerActive ? 'active' : ''}`}
        />
        {!composerActive ? (
          <button
            type="button"
            className="quick-launch"
            onClick={openChat}
            aria-label={`Apri la chat in ${targetLabel}`}
          >
            <span className="quick-launch-icon">
              <Smile size={21} />
            </span>
            <span className="quick-launch-copy">
              <strong>Scrivi in {target === 'general' ? '#generale' : targetLabel}</strong>
              <small>Apri la chat</small>
            </span>
          </button>
        ) : null}

        <button
          type="button"
          className={`quick-groups ${wheelOpen ? 'active' : ''}`}
          onClick={() => setWheelOpen((open) => !open)}
          aria-label="Scegli il gruppo"
          aria-haspopup="dialog"
          aria-controls="group-wheel"
          aria-expanded={wheelOpen}
          title="Gruppi"
        >
          <Users size={18} />
        </button>

        <NavLink
          to="/"
          end
          className={({ isActive }) => `quick-home ${isActive ? 'active' : ''}`}
          onClick={() => setWheelOpen(false)}
          aria-label="Vai alla Home"
          title="Home"
        >
          <Home size={18} />
        </NavLink>
      </div>

      {wheelOpen ? (
        <GroupWheel
          items={items}
          target={target}
          onSelect={selectTarget}
          onClose={() => setWheelOpen(false)}
        />
      ) : null}
    </nav>
  );
}
