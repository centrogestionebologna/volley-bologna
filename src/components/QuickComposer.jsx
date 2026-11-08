import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Home, MessageCircle, Users } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { store } from '../backend';
import { useSubscription } from '../lib/hooks';
import { GroupWheel } from './GroupWheel';

export function QuickComposer() {
  const { uid } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const routeGroupId = location.pathname.match(/^\/gruppi\/([^/]+)$/)?.[1] || '';
  const [target, setTarget] = useState(routeGroupId || 'general');
  const [targets, setTargets] = useState([]);
  const [wheelOpen, setWheelOpen] = useState(false);
  const dockRef = useRef(null);

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
    if (targets.length === 0) setWheelOpen(false);
  }, [target, targets]);

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
    setWheelOpen(false);
  }, [location.pathname, targets]);

  const openChat = () => {
    setWheelOpen(false);
    navigate(chatPath, { state: { focusRequest: Date.now() } });
  };

  return (
    <nav className="bottom-nav" aria-label="Chat rapida" ref={dockRef}>
      <div className="quick-composer">
        <button
          type="button"
          className="quick-launch"
          onClick={openChat}
          aria-label={`Apri la chat in ${targetLabel}`}
        >
          <span className="quick-launch-icon">
            <MessageCircle size={19} />
          </span>
          <span className="quick-launch-copy">
            <strong>Scrivi in {target === 'general' ? '#generale' : targetLabel}</strong>
            <small>Apri la chat</small>
          </span>
        </button>

        {targets.length > 0 ? (
          <button
            type="button"
            className={`quick-wheel-trigger ${wheelOpen ? 'active' : ''}`}
            onClick={() => setWheelOpen((open) => !open)}
            aria-label={`Scegli il gruppo, attuale ${targetLabel}`}
            aria-expanded={wheelOpen}
            title="Scegli il gruppo"
          >
            <Users size={17} />
          </button>
        ) : (
          <span className="quick-wheel-empty" aria-hidden />
        )}

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

      {wheelOpen && targets.length > 0 ? (
        <GroupWheel
          items={items}
          target={target}
          onSelect={setTarget}
          onClose={() => setWheelOpen(false)}
        />
      ) : null}
    </nav>
  );
}
