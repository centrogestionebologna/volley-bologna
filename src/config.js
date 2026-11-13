const env = import.meta.env;

export const APP_NAME = 'Volley Bologna Community';
export const ADMIN_NAME = 'Adriano';

/** Logo della community: usa il file ufficiale per evitare cache o asset vecchi. */
const configuredLogo = env.VITE_LOGO_URL;
export const LOGO_URL =
  !configuredLogo || /^\/logo\.(svg|png)(\?.*)?$/.test(configuredLogo)
    ? '/community-logo.png?v=3'
    : configuredLogo;

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
  maxNicknameLength: 32,
  maxPlayers: 40,
};

export const GROUP_SETTING_OPTIONS = {
  sendMessagesPolicy: [
    { value: 'all', label: 'Tutti i membri' },
    { value: 'admins', label: 'Solo fondatore e admin' },
  ],
  editInfoPolicy: [
    { value: 'all', label: 'Tutti i membri' },
    { value: 'admins', label: 'Solo fondatore e admin' },
  ],
  addMembersPolicy: [
    { value: 'all', label: 'Tutti i membri' },
    { value: 'admins', label: 'Solo fondatore e admin' },
  ],
  matchOrganizersPolicy: [
    { value: 'all', label: 'Tutti i membri' },
    { value: 'admins', label: 'Solo fondatore e admin' },
  ],
  disappearingMessages: [
    { value: 'off', label: 'Disattivati (30 giorni)' },
    { value: '24h', label: '24 ore' },
    { value: '7d', label: '7 giorni' },
    { value: '90d', label: '90 giorni' },
  ],
};

// Dati che il fondatore può richiedere a chi chiede di entrare nel gruppo.
// Restano privati: il gruppo salva solo se sono presenti, non i valori.
export const PROFILE_REQUIREMENTS = [
  { value: 'fullName', label: 'Nome e cognome' },
  { value: 'phone', label: 'Numero di telefono' },
  { value: 'email', label: 'Email' },
];

export const DEFAULT_GROUP_SETTINGS = {
  icon: '',
  sendMessagesPolicy: 'all',
  editInfoPolicy: 'all',
  addMembersPolicy: 'all',
  matchOrganizersPolicy: 'all',
  requiredProfileFields: [],
  approveNewMembers: false,
  disappearingMessages: 'off',
};

export function normalizeGroupSettings(source) {
  const raw = source && typeof source === 'object' ? source : {};
  const policy = (value) => (value === 'admins' ? 'admins' : 'all');
  const disappearing = ['24h', '7d', '90d'].includes(raw.disappearingMessages)
    ? raw.disappearingMessages
    : 'off';
  const allowedRequirements = new Set(PROFILE_REQUIREMENTS.map((item) => item.value));
  const requiredProfileFields = Array.isArray(raw.requiredProfileFields)
    ? [...new Set(raw.requiredProfileFields.filter((value) => allowedRequirements.has(value)))]
    : [];
  return {
    icon: Array.from(String(raw.icon || '').trim()).slice(0, 4).join(''),
    sendMessagesPolicy: policy(raw.sendMessagesPolicy),
    editInfoPolicy: policy(raw.editInfoPolicy),
    addMembersPolicy: policy(raw.addMembersPolicy),
    matchOrganizersPolicy: policy(raw.matchOrganizersPolicy),
    requiredProfileFields,
    approveNewMembers: raw.approveNewMembers === true,
    disappearingMessages: disappearing,
  };
}

export function retentionDaysForSetting(value) {
  if (value === '24h') return 1;
  if (value === '7d') return 7;
  if (value === '90d') return 90;
  return LIMITS.messageRetentionDays;
}

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

export const VOLLEY_ROLES = [
  { value: 'palleggiatore', label: 'Palleggiatore' },
  { value: 'schiacciatore', label: 'Schiacciatore' },
  { value: 'centrale', label: 'Centrale' },
  { value: 'opposto', label: 'Opposto' },
  { value: 'libero', label: 'Libero' },
];

export const labelOf = (list, value) => list.find((item) => item.value === value)?.label || value;
