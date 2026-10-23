import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { countdownParts } from '../lib/format';

export function Countdown({ expiresAt, onExpire, compact = false }) {
  const [parts, setParts] = useState(() => countdownParts(expiresAt));

  useEffect(() => {
    setParts(countdownParts(expiresAt));
    const id = setInterval(() => setParts(countdownParts(expiresAt)), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  useEffect(() => {
    if (parts?.expired && onExpire) onExpire();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts?.expired]);

  if (!parts) return null;
  const urgency = parts.expired ? 'expired' : parts.minutes < 5 ? 'urgent' : 'calm';

  return (
    <span className={`countdown countdown-${urgency}`}>
      <Timer size={14} aria-hidden />
      {parts.expired ? 'Tempo scaduto' : compact ? parts.label : `Tempo rimasto: ${parts.label}`}
    </span>
  );
}
