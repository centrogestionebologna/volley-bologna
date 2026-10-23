export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function generateInviteCode(prefix = 'VOLLEY') {
  const random = crypto.getRandomValues(new Uint8Array(4));
  const token = [...random].map((byte) => byte.toString(36).padStart(2, '0')).join('').toUpperCase();
  return `${prefix}-${token}`;
}
