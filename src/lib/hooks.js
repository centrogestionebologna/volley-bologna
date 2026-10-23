import { useCallback, useEffect, useRef, useState } from 'react';

export function useSubscription(factory, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    let active = true;
    let unsubscribe = null;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      unsubscribe = factory((data) => {
        if (active) setState({ loading: false, data, error: null });
      });
    } catch (error) {
      if (active) setState({ loading: false, data: null, error });
    }
    return () => {
      active = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let active = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    Promise.resolve()
      .then(() => loaderRef.current())
      .then((data) => {
        if (active) setState({ loading: false, data, error: null });
      })
      .catch((error) => {
        if (active) setState({ loading: false, data: null, error });
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
