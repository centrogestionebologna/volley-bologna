import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { ToastProvider } from './components/Toast';
import { ChatComposerDockProvider } from './components/ChatComposerDock';
import { SetupScreen } from './components/SetupScreen';
import { isFirebaseConfigured } from './config';
import './styles.css';

function Root() {
  if (!isFirebaseConfigured) return <SetupScreen />;

  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ChatComposerDockProvider>
            <App />
          </ChatComposerDockProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
