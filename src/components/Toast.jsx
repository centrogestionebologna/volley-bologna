import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Info, XCircle } from 'lucide-react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const counter = useRef(0);

  const remove = useCallback((id) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (message, tone = 'info') => {
      counter.current += 1;
      const id = counter.current;
      setItems((prev) => [...prev.slice(-3), { id, message, tone }]);
      setTimeout(() => remove(id), 4200);
    },
    [remove]
  );

  const api = useMemo(
    () => ({
      success: (message) => push(message, 'success'),
      error: (message) => push(message, 'error'),
      info: (message) => push(message, 'info'),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((item) => {
          const Icon = item.tone === 'success' ? CheckCircle2 : item.tone === 'error' ? XCircle : Info;
          return (
            <div key={item.id} className={`toast toast-${item.tone}`}>
              <Icon size={18} />
              <span>{item.message}</span>
              <button type="button" className="toast-close" onClick={() => remove(item.id)} aria-label="Chiudi">
                ×
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast deve essere usato dentro ToastProvider');
  return context;
}
