import { Link, Navigate, Route, Routes } from 'react-router';
import { useAuth } from './auth';
import { Avatar, Loading } from './components';
import { isConfigured } from './config';
import { AuthPage } from './pages/AuthPage';
import { BetPage } from './pages/BetPage';
import { GroupPage } from './pages/GroupPage';
import { HomePage } from './pages/HomePage';
import { JoinPage } from './pages/JoinPage';
import { NewBetPage } from './pages/NewBetPage';
import { ProfilePage } from './pages/ProfilePage';

export function App() {
  const { user, loading } = useAuth();

  if (!isConfigured) {
    return (
      <main className="page auth-page">
        <div className="auth-hero">
          <span className="brand-mark big">vs</span>
          <h1>Bet with Friends</h1>
        </div>
        <p className="empty">
          Almost ready. Add your Supabase project&rsquo;s URL and publishable key to <code>web/src/config.ts</code>.
        </p>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="page">
        <Loading />
      </main>
    );
  }

  // Logged-out visitors see the auth screen at whatever URL they opened, and
  // land on that page once they log in. Invite links get a friendlier prompt.
  if (!user) {
    return (
      <Routes>
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="*" element={<AuthPage />} />
      </Routes>
    );
  }

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">vs</span> Bet with Friends
        </Link>
        <Link to="/profile" aria-label="Your profile">
          <Avatar user={user} size={34} />
        </Link>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/groups/:id" element={<GroupPage />} />
          <Route path="/groups/:id/new" element={<NewBetPage />} />
          <Route path="/bets/:id" element={<BetPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/join/:code" element={<JoinPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
