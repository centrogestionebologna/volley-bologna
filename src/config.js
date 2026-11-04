const env = import.meta.env;

export const APP_NAME = 'Volley Bologna Community';
export const ADMIN_NAME = 'Adriano';

/** Logo della community: sostituibile con un'immagine diversa via VITE_LOGO_URL. */
export const LOGO_URL = env.VITE_LOGO_URL || '/logo.svg';

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || '',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: env.VITE_FIREBASE_APP_ID || '',
};

const requiredFirebaseKeys = {
  VITE_FIREBASE_API_KEY: firebaseConfig.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: firebaseConfig.authDomain,
  VITE_FIREBASE_PROJECT_ID: firebaseConfig.projectId,
  VITE_FIREBASE_APP_ID: firebaseConfig.appId,
};

export const missingFirebaseKeys = Object.entries(requiredFirebaseKeys)
  .filter(([, value]) => !value)
  .map(([key]) => key);

/** Senza queste variabili l'app non può funzionare: nessun fallback locale. */
export const isFirebaseConfigured = missingFirebaseKeys.length === 0;

/** Limiti e costanti di prodotto (tutti compatibili con i piani gratuiti). */
export const LIMITS = {
  messageRetentionDays: 30,
  offerMinutes: 30,
  messagesPageSize: 40,
  maxMessageLength: 1200,
  maxNicknameLength: 24,
  maxPlayers: 40,
};

export const AGE_BANDS = [
  { value: 'liceo', label: 'Liceo' },
  { value: 'universitari', label: 'Universitari' },
  { value: 'over30', label: 'Over 30' },
];

export const LEVELS = [
  { value: 'principiante', label: 'Principiante' },
  { value: 'intermedio', label: 'Intermedio' },
  { value: 'avanzato', label: 'Avanzato' },
  { value: 'agonistico', label: 'Agonistico' },
];

export const labelOf = (list, value) => list.find((item) => item.value === value)?.label || value;
