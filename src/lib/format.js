// Piccole utility di formattazione (date, importi, nomi).

const DAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const MONTHS = [
  'gen', 'feb', 'mar', 'apr', 'mag', 'giu',
  'lug', 'ago', 'set', 'ott', 'nov', 'dic',
];

export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export function pad(n) {
  return String(n).padStart(2, '0');
}

export function dateKey(date) {
  const d = toDate(date);
  if (!d) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function timeKey(date) {
  const d = toDate(date);
  if (!d) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDateShort(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function formatDateLong(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${formatDateShort(d)} · ${formatTime(d)}`;
}

export function formatRelative(value) {
  const d = toDate(value);
  if (!d) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'adesso';
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'ieri';
  if (days < 7) return `${days} g`;
  return formatDateShort(d);
}

export function formatEuros(value) {
  const n = Number(value || 0);
  if (!n) return 'Gratis';
  return `${n.toFixed(n % 1 === 0 ? 0 : 2).replace('.', ',')} €`;
}

export function countdownParts(expiresAt) {
  const d = toDate(expiresAt);
  if (!d) return null;
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return { expired: true, label: 'scaduto', minutes: 0 };
  const totalSeconds = Math.floor(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return {
    expired: false,
    minutes,
    seconds,
    label: minutes >= 1 ? `${minutes} min ${pad(seconds)} s` : `${seconds} s`,
  };
}

export function initials(name = '') {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase();
}

export function splitName(displayName = '') {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 0) return { realName: '', surname: '' };
  if (parts.length === 1) return { realName: parts[0], surname: '' };
  return { realName: parts.slice(0, -1).join(' '), surname: parts[parts.length - 1] };
}

export function suggestNickname(displayName = '', email = '') {
  const base = (displayName || email.split('@')[0] || 'giocatore')
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .trim();
  const compact = base.replace(/\s+/g, '');
  return (compact || 'Giocatore').slice(0, 18);
}
