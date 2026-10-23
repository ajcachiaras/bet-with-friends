import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { useMe } from '../auth';
import { BetCard, ErrorNote, Loading, Section, useLoad } from '../components';

export function HomePage() {
  const me = useMe();
  const bets = useLoad(() => api.myBets(), []);
  const groups = useLoad(() => api.groups(), []);

  if (bets.error || groups.error) return <ErrorNote message={bets.error ?? groups.error} />;
  if (!bets.data || !groups.data) return <Loading />;

  const yourMove = bets.data.bets.filter((b) => b.todo);
  const live = bets.data.bets.filter(
    (b) => !b.todo && ['proposed', 'active', 'reported', 'disputed'].includes(b.status),
  );

  return (
    <>
      <h1 className="greeting">Hey {me.displayName.split(' ')[0]} 👋</h1>

      {yourMove.length > 0 && (
        <Section title="Your move">
          <div className="stack">
            {yourMove.map((b) => (
              <BetCard key={b.id} bet={b} meId={me.id} showGroup />
            ))}
          </div>
        </Section>
      )}

      {live.length > 0 && (
        <Section title="Live bets">
          <div className="stack">
            {live.map((b) => (
              <BetCard key={b.id} bet={b} meId={me.id} showGroup />
            ))}
          </div>
        </Section>
      )}

      <Section title="Your groups">
        {groups.data.groups.length === 0 ? (
          <p className="empty">
            Bets happen inside groups. Start one for your friends, or join with an invite code someone sent you.
          </p>
        ) : (
          <div className="stack">
            {groups.data.groups.map((g) => (
              <Link key={g.id} to={`/groups/${g.id}`} className="card group-row">
                <div>
                  <div className="group-name">{g.name}</div>
                  <div className="muted">
                    {g.memberCount} {g.memberCount === 1 ? 'member' : 'members'}
                    {g.liveBets > 0 && ` · ${g.liveBets} live ${g.liveBets === 1 ? 'bet' : 'bets'}`}
                  </div>
                </div>
                <span className="chevron">&rsaquo;</span>
              </Link>
            ))}
          </div>
        )}
        <GroupForms />
      </Section>
    </>
  );
}

function GroupForms() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function run(e: FormEvent, action: () => Promise<{ groupId: number }>) {
    e.preventDefault();
    setError(null);
    try {
      const { groupId } = await action();
      navigate(`/groups/${groupId}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="group-forms">
      <form className="inline-form" onSubmit={(e) => run(e, () => api.createGroup(name))}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New group name" maxLength={50} required />
        <button className="btn primary">Create</button>
      </form>
      <form className="inline-form" onSubmit={(e) => run(e, () => api.joinGroup(code))}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Invite code"
          autoCapitalize="characters"
          maxLength={6}
          required
        />
        <button className="btn">Join</button>
      </form>
      <ErrorNote message={error} />
    </div>
  );
}
