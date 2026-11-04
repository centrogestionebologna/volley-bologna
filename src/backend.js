import { firebaseConfig, isFirebaseConfigured } from './config';
import { createFirestoreBackend } from './store/firestoreAdapter';

/**
 * Unico backend dell'app: Cloud Firestore.
 * Se la configurazione manca, main.jsx mostra la schermata di setup e non monta l'app.
 */
const backend = isFirebaseConfigured ? createFirestoreBackend(firebaseConfig) : null;

export const store = backend?.store ?? null;
export const auth = backend?.auth ?? null;
export const isConfigured = isFirebaseConfigured;
