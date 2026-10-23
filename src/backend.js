import { firebaseConfig, demoMode } from './config';
import { createLocalBackend } from './store/localAdapter';

let backend;

if (demoMode) {
  backend = createLocalBackend();
} else {
  // Firebase viene caricato solo quando serve: la modalità demo resta leggerissima.
  const { createFirestoreBackend } = await import('./store/firestoreAdapter');
  backend = createFirestoreBackend(firebaseConfig);
}

export const store = backend.store;
export const auth = backend.auth;
export const isDemo = demoMode;
