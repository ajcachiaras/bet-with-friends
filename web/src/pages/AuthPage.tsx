import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { ErrorNote } from '../components';

export function AuthPage({ banner }: { banner?: string }) {
  const { setUser } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>(banner ? 'signup' : 'login');
  const [form, setForm] = useState({ email: '', displayName: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (field: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } =
        mode === 'login'
          ? await api.login({ email: form.email, password: form.password })
          : await api.signup(form);
      setUser(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page auth-page">
      <div className="auth-hero">
        <span className="brand-mark big">vs</span>
        <h1>Bet with Friends</h1>
        <p className="muted">Make bets with your crew. Keep score. Talk trash.</p>
      </div>

      {banner && <p className="banner">{banner}</p>}

      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')}>
          Log in
        </button>
        <button role="tab" aria-selected={mode === 'signup'} onClick={() => setMode('signup')}>
          Sign up
        </button>
      </div>

      <form className="card form" onSubmit={submit}>
        {mode === 'signup' && (
          <label>
            Your name
            <input
              value={form.displayName}
              onChange={set('displayName')}
              autoComplete="name"
              required
              maxLength={40}
              placeholder="What your friends call you"
            />
          </label>
        )}
        <label>
          Email
          <input
            type="email"
            value={form.email}
            onChange={set('email')}
            autoComplete="email"
            autoCapitalize="none"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={form.password}
            onChange={set('password')}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'signup' ? 8 : undefined}
          />
        </label>
        <ErrorNote message={error} />
        <button className="btn primary" disabled={busy}>
          {mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>
    </main>
  );
}
