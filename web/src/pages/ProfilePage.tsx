import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { useAuth, useMe } from '../auth';
import { Avatar, ErrorNote } from '../components';

export function ProfilePage() {
  const me = useMe();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const { user } = await api.updateMe({ displayName });
      setUser(user);
      setDisplayName(user.displayName);
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
          <p className="muted">{me.email}</p>
        </div>
      </div>

      <form className="card form" onSubmit={save}>
        <label>
          Your name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={40} />
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
