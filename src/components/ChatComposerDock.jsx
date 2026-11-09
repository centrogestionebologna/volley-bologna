import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ChatComposerDockContext = createContext(null);

export function ChatComposerDockProvider({ children }) {
  const [slot, setSlot] = useState(null);
  const [active, setActive] = useState(false);
  const [wheelRequest, setWheelRequest] = useState(0);
  const requestGroupWheel = useCallback(() => setWheelRequest((value) => value + 1), []);
  const value = useMemo(
    () => ({ slot, setSlot, active, setActive, wheelRequest, requestGroupWheel }),
    [slot, active, wheelRequest, requestGroupWheel]
  );

  return (
    <ChatComposerDockContext.Provider value={value}>
      {children}
    </ChatComposerDockContext.Provider>
  );
}

export function useChatComposerDock() {
  const context = useContext(ChatComposerDockContext);
  if (!context) throw new Error('useChatComposerDock deve essere usato dentro ChatComposerDockProvider');
  return context;
}
