/**
 * Sentinella usata dai servizi per scrivere un timestamp calcolato dal server.
 * L'adapter Firestore la converte in serverTimestamp(), quello demo in Date.now().
 */
export const SERVER_TS = Object.freeze({ __serverTimestamp: true });

export const serverTimestamp = () => SERVER_TS;

export function isServerTimestamp(value) {
  return value === SERVER_TS;
}

export function docId(path) {
  const parts = String(path).split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

export function collectionOf(path) {
  const parts = String(path).split('/').filter(Boolean);
  return parts.slice(0, -1).join('/');
}

export function matchesWhere(data, where = []) {
  return where.every(([field, op, value]) => {
    const current = readField(data, field);
    switch (op) {
      case '==':
        return current === value;
      case '!=':
        return current !== value;
      case '>':
        return current != null && current > value;
      case '>=':
        return current != null && current >= value;
      case '<':
        return current != null && current < value;
      case '<=':
        return current != null && current <= value;
      case 'array-contains':
        return Array.isArray(current) && current.includes(value);
      case 'array-contains-any':
        return Array.isArray(current) && Array.isArray(value) && value.some((item) => current.includes(item));
      case 'in':
        return Array.isArray(value) && value.includes(current);
      case 'not-in':
        return Array.isArray(value) && !value.includes(current);
      default:
        return true;
    }
  });
}

function readField(data, field) {
  if (data == null) return undefined;
  if (!field.includes('.')) return data[field];
  return field.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), data);
}

export function applyOrderAndLimit(rows, orderBy, limit) {
  const orders = !orderBy ? [] : Array.isArray(orderBy[0]) ? orderBy : [orderBy];
  let result = rows;
  if (orders.length) {
    result = [...rows].sort((a, b) => {
      for (const [field, dir = 'asc'] of orders) {
        const av = a.data?.[field];
        const bv = b.data?.[field];
        if (av === bv) continue;
        if (av == null) return -1;
        if (bv == null) return 1;
        const cmp = av < bv ? -1 : 1;
        return dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  }
  if (typeof limit === 'number') result = result.slice(0, limit);
  return result;
}

export function statusForSeat(match, hasPendingOffer) {
  if (hasPendingOffer) return 'waitlist';
  return (match.confirmedCount || 0) < match.maxPlayers ? 'confirmed' : 'waitlist';
}
