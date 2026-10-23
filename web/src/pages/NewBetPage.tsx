import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { useMe } from '../auth';
import { Avatar, ErrorNote, Loading, useLoad } from '../components';

const QUICK_AMOUNTS = [5, 10, 20, 50];

export function NewBetPage() {
  const me = useMe();
  const navigate = useNavigate();
  const groupId = Number(useParams().id);
  const group = useLoad(() => api.group(groupId), [groupId]);

  const [opponentId, setOpponentId] = useState<number | null>(null);
  const [form, setForm] = useState({ title: '', creatorSide: '', opponentSide: '', amount: '', settleBy: '', details: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (group.error) return <ErrorNote message={group.error} />;
  if (!group.data) return <Loading />;

  const others = group.data.members.filter((u) => u.id !== me.id);
  const opponent = others.find((u) => u.id === opponentId);
  const set = (field: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!opponentId) {
      setError('Pick who you’re betting against.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { betId } = await api.createBet(groupId, { opponentId, ...form });
      navigate(`/bets/${betId}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <Link to={`/groups/${groupId}`} className="back">
        &lsaquo; {group.data.group.name}
      </Link>
      <h1>New bet</h1>

      <form className="card form" onSubmit={submit}>
        <fieldset>
          <legend>Who are you betting?</legend>
          <div className="chips">
            {others.map((u) => (
              <button
                type="button"
                key={u.id}
                className={`chip${u.id === opponentId ? ' selected' : ''}`}
                aria-pressed={u.id === opponentId}
                onClick={() => setOpponentId(u.id)}
              >
                <Avatar user={u} size={22} /> {u.displayName}
              </button>
            ))}
          </div>
        </fieldset>

        <label>
          What&rsquo;s the bet?
          <input value={form.title} onChange={set('title')} placeholder="Chiefs vs Bills on Sunday" required maxLength={120} />
        </label>

        <div className="sides">
          <label>
            Your side
            <input value={form.creatorSide} onChange={set('creatorSide')} placeholder="Chiefs win" required maxLength={120} />
          </label>
          <label>
            {opponent ? `${opponent.displayName}’s side` : 'Their side'}
            <input value={form.opponentSide} onChange={set('opponentSide')} placeholder="Bills win" required maxLength={120} />
          </label>
        </div>

        <label>
          Amount
          <div className="input-prefix">
            <span>$</span>
            <input value={form.amount} onChange={set('amount')} inputMode="decimal" placeholder="20" required />
          </div>
          <div className="chips">
            {QUICK_AMOUNTS.map((a) => (
              <button
                type="button"
                key={a}
                className={`chip${form.amount === String(a) ? ' selected' : ''}`}
                onClick={() => setForm((f) => ({ ...f, amount: String(a) }))}
              >
                ${a}
              </button>
            ))}
          </div>
        </label>

        <label>
          Settle by <span className="muted">(optional)</span>
          <input type="date" value={form.settleBy} onChange={set('settleBy')} />
        </label>

        <label>
          Fine print <span className="muted">(optional)</span>
          <textarea
            value={form.details}
            onChange={set('details')}
            rows={3}
            maxLength={1000}
            placeholder="Overtime counts. Loser pays within 24 hours."
          />
        </label>

        <ErrorNote message={error} />
        <button className="btn primary" disabled={busy}>
          {opponent ? `Send bet to ${opponent.displayName}` : 'Send bet'}
        </button>
      </form>
    </>
  );
}
