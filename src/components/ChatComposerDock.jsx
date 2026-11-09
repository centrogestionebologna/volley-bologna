import { createContext, useContext, useMemo, useState } from 'react';

const ChatComposerDockContext = createContext(null);

export function ChatComposerDockProvider({ children }) {
  const [slot, setSlot] = useState(null);
  const [active, setActive] = useState(false);
  const value = useMemo(
    () => ({ slot, setSlot, active, setActive }),
    [slot, active]
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
