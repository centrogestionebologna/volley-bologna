const env = import.meta.env;

export const APP_NAME = 'Volley Bologna Community';
export const ADMIN_NAME = 'Adriano';

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || '',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: env.VITE_FIREBASE_APP_ID || '',
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId && firebaseConfig.authDomain
);

export const forceDemo = env.VITE_DEMO_MODE === 'true';
export const demoMode = forceDemo || !isFirebaseConfigured;

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
