import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { Matches } from './pages/Matches';
import { MatchDetail } from './pages/MatchDetail';
import { MatchForm } from './pages/MatchForm';
import { Groups } from './pages/Groups';
import { GroupDetail } from './pages/GroupDetail';
import { Chat } from './pages/Chat';
import { Profile } from './pages/Profile';
import { PublicProfile } from './pages/PublicProfile';
import { Organizer } from './pages/Organizer';
import { Admin } from './pages/Admin';

function Splash() {
  return (
    <div className="splash">
      <span className="splash-ball">🏐</span>
      <strong>Volley Bologna Community</strong>
      <span className="spinner" />
    </div>
  );
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading && !user) return <Splash />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading && !user) return <Splash />;
  if (user) return <Navigate to="/" replace />;
  return <Login />;
}

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Home />} />
        <Route path="/match" element={<Matches />} />
        <Route path="/match/nuovo" element={<MatchForm />} />
        <Route path="/match/:matchId" element={<MatchDetail />} />
        <Route path="/match/:matchId/modifica" element={<MatchForm />} />
        <Route path="/gruppi" element={<Groups />} />
        <Route path="/gruppi/:groupId" element={<GroupDetail />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/profilo" element={<Profile />} />
        <Route path="/organizzatore" element={<Organizer />} />
        <Route path="/u/:userId" element={<PublicProfile />} />
        <Route path="/admin" element={<Admin />} />
        <Route
          path="*"
          element={
            <div className="page page-narrow">
              <div className="empty">
                <h3>Pagina non trovata</h3>
                <p>Il link che hai aperto non esiste o è stato spostato.</p>
              </div>
            </div>
          }
        />
      </Route>
      <Route path="*" element={user ? <Navigate to="/" replace /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
