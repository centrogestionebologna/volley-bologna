import { store } from '../backend';
import { serverTimestamp } from '../store/base';
import { sha256Hex } from '../lib/crypto';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';
const SW_PATH = '/push-sw.js';
const TAG_CHARS = /[^A-Za-z0-9_-]/g;

export const isPushConfigured = Boolean(VAPID_PUBLIC_KEY);

export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function base64UrlToBytes(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const deviceIdFor = async (endpoint) => (await sha256Hex(endpoint)).slice(0, 40);

async function activeRegistration() {
  await navigator.serviceWorker.register(SW_PATH, { scope: '/' });
  return navigator.serviceWorker.ready;
}

async function currentSubscription() {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/** 'unsupported' | 'unconfigured' | 'denied' | 'default' | 'granted' | 'subscribed' */
export async function getPushState() {
  if (!isPushSupported()) return 'unsupported';
  if (!isPushConfigured) return 'unconfigured';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'default') return 'default';
  try {
    const subscription = await currentSubscription();
    return subscription ? 'subscribed' : 'granted';
  } catch {
    return 'granted';
  }
}

export async function enablePush(uid) {
  if (!uid) throw new Error('Sessione non valida: ricarica la pagina.');
  if (!isPushConfigured) {
    throw new Error('Notifiche non configurate: manca VITE_VAPID_PUBLIC_KEY nel build.');
  }
  if (!isPushSupported()) throw new Error('Questo browser non supporta le notifiche push.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Permesso negato: riabilitalo dalle impostazioni del sito nel browser.'
        : 'Permesso non concesso: riprova e scegli “Consenti”.'
    );
  }

  const registration = await activeRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY),
    });
  }

  const json = subscription.toJSON();
  if (!json?.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('Il browser non ha restituito una subscription valida.');
  }

  const deviceId = await deviceIdFor(json.endpoint);
  // Lettura + scrittura esplicita: la mappa `devices` non deve perdere gli altri
  // dispositivi dello stesso utente.
  const existing = await store.getDoc(`pushSubscriptions/${uid}`).catch(() => null);
  const devices = { ...(existing?.data?.devices || {}) };
  devices[deviceId] = {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    ua: String(navigator.userAgent || '').slice(0, 160),
    addedAt: new Date().toISOString(),
  };
  await store.setDoc(`pushSubscriptions/${uid}`, {
    uid,
    devices,
    updatedAt: serverTimestamp(),
  });
  return true;
}

export async function disablePush(uid) {
  if (!uid) return false;
  const subscription = await currentSubscription();
  if (subscription) {
    const deviceId = await deviceIdFor(subscription.endpoint);
    try {
      await subscription.unsubscribe();
    } catch (error) {
      console.warn('Subscription non annullata', error?.message);
    }
    const doc = await store.getDoc(`pushSubscriptions/${uid}`);
    const devices = { ...(doc?.data?.devices || {}) };
    if (devices[deviceId]) {
      delete devices[deviceId];
      await store.setDoc(`pushSubscriptions/${uid}`, {
        uid,
        devices,
        updatedAt: serverTimestamp(),
      });
    }
  }
  return true;
}

export async function disablePushQuietly(uid) {
  try {
    await disablePush(uid);
  } catch (error) {
    console.warn('Notifiche non disattivate', error?.message);
  }
}

/**
 * Accoda una notifica: il Worker `volley-bologna-push` la smista ogni minuto.
 * Non deve mai bloccare l'azione principale: gli errori restano nel log.
 */
export async function queuePush({
  type = 'system',
  title,
  body,
  url = '/',
  tag = '',
  audience = 'all',
  groupId = null,
  userId = null,
  matchId = null,
  actorId = null,
} = {}) {
  if (!isPushConfigured || !store) return false;
  try {
    await store.addDoc('pushJobs', {
      type: String(type).slice(0, 32),
      title: String(title || 'Volley Bologna Community').slice(0, 120),
      body: String(body || '').slice(0, 240),
      url: String(url || '/').slice(0, 200),
      tag: String(tag || '').replace(TAG_CHARS, '').slice(0, 32),
      audience,
      groupId,
      userId,
      matchId,
      actorId,
      createdAt: serverTimestamp(),
    });
    return true;
  } catch (error) {
    console.warn('Notifica non accodata', error?.message);
    return false;
  }
}
