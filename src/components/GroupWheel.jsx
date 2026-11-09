import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Selettore verticale a ruota: le destinazioni scorrono davanti al centro
 * e quelle in alto/in basso si inclinano come cabine viste di taglio.
 */
export function GroupWheel({ items, target, onSelect, onClose }) {
  const wheelRef = useRef(null);
  const itemRefs = useRef({});
  const targetRef = useRef(target);
  targetRef.current = target;

  const select = (id) => {
    if (id === targetRef.current) return;
    targetRef.current = id;
    onSelect(id);
  };

  useEffect(() => {
    const container = wheelRef.current;
    if (!container) return undefined;

    let frame = 0;
    let cancelled = false;

    const update = () => {
      if (cancelled) return;
      const center = container.scrollTop + container.clientHeight / 2;
      let closestId = null;
      let closestDistance = Infinity;

      for (const item of items) {
        const node = itemRefs.current[item.id];
        if (!node) continue;

        const itemCenter = node.offsetTop + node.offsetHeight / 2;
        const delta = itemCenter - center;
        const distance = Math.abs(delta);
        const angle = Math.max(-38, Math.min(38, delta * 0.22));
        const scale = Math.max(0.84, 1 - distance / 520);

        node.style.transform = `perspective(300px) rotateX(${-angle}deg) scale(${scale})`;
        node.style.opacity = String(Math.max(0.38, 1 - distance / 165));
        node.style.zIndex = distance < 18 ? '2' : '1';

        if (distance < closestDistance) {
          closestDistance = distance;
          closestId = item.id;
        }
      }

      if (closestId) select(closestId);
    }

    const centerSelected = () => {
      const node = itemRefs.current[targetRef.current];
      if (!node) return;
      container.scrollTop = node.offsetTop - (container.clientHeight - node.offsetHeight) / 2;
    };

    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };

    const initial = requestAnimationFrame(() => {
      centerSelected();
      update();
    });

    container.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    return () => {
      cancelled = true;
      cancelAnimationFrame(initial);
      cancelAnimationFrame(frame);
      container.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [items, onSelect]);

  return (
    <div className="group-wheel-popover" role="dialog" aria-label="Scegli il gruppo">
      <div className="group-wheel-head">
        <div>
          <strong>Scegli la chat</strong>
          <small>{items.length} destinazioni</small>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Chiudi selettore">
          <X size={16} />
        </button>
      </div>

      <div className="group-wheel-wrap">
        <div className="group-wheel-center" aria-hidden />
        <div className="group-wheel" ref={wheelRef} role="listbox" aria-label="Chat disponibili">
          {items.map((item) => (
            <div
              key={item.id}
              ref={(node) => {
                itemRefs.current[item.id] = node;
              }}
              className={`group-wheel-item ${target === item.id ? 'active' : ''}`}
              role="option"
              aria-selected={target === item.id}
              title={item.name}
            >
              {item.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
