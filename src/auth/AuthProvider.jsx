import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { auth } from '../backend';
import {
  ensureProfile,
  subscribePrivateProfile,
  subscribeAdmin,
} from '../services/profiles';
import { subscribeMyOffers } from '../services/matches';
import { toDate } from '../lib/format';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [fbUser, setFbUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [admin, setAdmin] = useState(false);
  const [offers, setOffers] = useState([]);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let unsubProfile = null;
    let unsubAdmin = null;
    let unsubOffers = null;

    const cleanup = () => {
      unsubProfile?.();
      unsubAdmin?.();
      unsubOffers?.();
      unsubProfile = null;
      unsubAdmin = null;
      unsubOffers = null;
    };

    const unsubAuth = auth.subscribe(async (user) => {
      cleanup();
      setFbUser(user);
      setError('');

      if (!user) {
        setProfile(null);
        setAdmin(false);
        setOffers([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        await ensureProfile(user);
      } catch (err) {
        console.error(err);
        setError(
          err?.code === 'permission-denied'
            ? 'Permessi Firestore negati: controlla di aver pubblicato le regole di sicurezza.'
            : err.message || 'Impossibile creare il profilo.'
        );
      }

      unsubProfile = subscribePrivateProfile(user.uid, (doc) => {
        setProfile(doc?.data || null);
        setLoading(false);
      });
      unsubAdmin = subscribeAdmin(user.uid, setAdmin);
      unsubOffers = subscribeMyOffers(user.uid, (rows) =>
        setOffers(rows.map((row) => ({ id: row.id, ...row.data })))
      );
    });

    return () => {
      unsubAuth?.();
      cleanup();
    };
  }, [version]);

  const signIn = useCallback(async () => {
    setError('');
    try {
      await auth.signIn();
    } catch (err) {
      setError(err.message || 'Accesso non riuscito.');
      throw err;
    }
  }, []);

  const signInDemo = useCallback(async (uid) => {
    setError('');
    await auth.signInDemo(uid);
  }, []);

  const signOut = useCallback(async () => {
    await auth.signOut();
  }, []);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const silencedUntil = toDate(profile?.silencedUntil);

  const value = useMemo(() => {
    const nickname = profile?.nickname || fbUser?.displayName || 'Giocatore';
    return {
      user: fbUser,
      uid: fbUser?.uid || null,
      profile,
      nickname,
      loading,
      error,
      isAdmin: admin,
      isDemo: auth.mode === 'demo',
      isBanned: Boolean(profile?.banned),
      isSilenced: Boolean(silencedUntil && silencedUntil.getTime() > Date.now()),
      silencedUntil,
      offers,
      signIn,
      signInDemo,
      signOut,
      refresh,
      clearError: () => setError(''),
    };
  }, [fbUser, profile, loading, error, admin, offers, silencedUntil, signIn, signInDemo, signOut, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve essere usato dentro AuthProvider');
  return context;
}
