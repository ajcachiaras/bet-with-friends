import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { useAuth, useMe } from '../auth';
import { Avatar, ErrorNote } from '../components';
import { venmoProfileUrl } from '../venmo';

export function ProfilePage() {
  const me = useMe();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ displayName: me.displayName, venmoUsername: me.venmoUsername });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const { user } = await api.updateMe(form);
      setUser(user);
      setForm({ displayName: user.displayName, venmoUsername: user.venmoUsername });
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function logout() {
    await api.logout();
    setUser(null);
    navigate('/');
  }

  return (
    <>
      <div className="profile-head">
        <Avatar user={me} size={64} />
        <div>
          <h1>{me.displayName}</h1>
          <p className="muted">@{me.username}</p>
        </div>
      </div>

      <form className="card form" onSubmit={save}>
        <label>
          Your name
          <input
            value={form.displayName}
            onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
            required
            maxLength={40}
          />
        </label>
        <label>
          Venmo username
          <div className="input-prefix">
            <span>@</span>
            <input
              value={form.venmoUsername}
              onChange={(e) => setForm((f) => ({ ...f, venmoUsername: e.target.value }))}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              maxLength={31}
            />
          </div>
          <small>
            <a href={venmoProfileUrl(me.venmoUsername)} target="_blank" rel="noopener noreferrer">
              Check that this is you on Venmo &rarr;
            </a>
          </small>
        </label>
        <ErrorNote message={error} />
        {saved && <p className="success">Saved.</p>}
        <button className="btn primary">Save</button>
      </form>

      <button className="btn subtle block" onClick={logout}>
        Log out
      </button>
    </>
  );
}
