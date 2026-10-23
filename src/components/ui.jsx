import { useEffect } from 'react';
import { X } from 'lucide-react';
import { initials } from '../lib/format';

const AVATAR_TONES = ['blue', 'green', 'amber', 'violet', 'rose', 'teal'];

export function Avatar({ name = '', src = '', size = 'md' }) {
  const tone = AVATAR_TONES[(name || 'V').charCodeAt(0) % AVATAR_TONES.length];
  return (
    <span className={`avatar avatar-${size} avatar-${tone}`} aria-hidden={!name}>
      {src ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" /> : initials(name) || 'V'}
    </span>
  );
}

export function Chip({ tone = 'muted', children, icon: Icon, className = '' }) {
  return (
    <span className={`chip chip-${tone} ${className}`}>
      {Icon ? <Icon size={13} aria-hidden /> : null}
      {children}
    </span>
  );
}

export function Spinner({ label = 'Caricamento…' }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text, children }) {
  return (
    <div className="empty">
      {Icon ? (
        <span className="empty-icon">
          <Icon size={26} />
        </span>
      ) : null}
      <h3>{title}</h3>
      {text ? <p>{text}</p> : null}
      {children}
    </div>
  );
}

export function Modal({ open, onClose, title, subtitle, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Chiudi">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }) {
  return (
    <label className="field" htmlFor={htmlFor}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function PageHead({ eyebrow, title, sub, actions }) {
  return (
    <header className="page-head">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Progress({ value, max, tone = 'blue' }) {
  const percent = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={`progress progress-${tone}`} aria-hidden>
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}
