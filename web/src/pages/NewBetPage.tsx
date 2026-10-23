import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { useMe } from '../auth';
import { Avatar, ErrorNote, Loading, OpenSeat, useLoad } from '../components';
import { formatPoints } from '../format';

const QUICK_POINTS = [5, 10, 25, 50];

// Picking this instead of a member posts the bet to the group board.
const ANYONE = 'anyone';

export function NewBetPage() {
  const me = useMe();
  const navigate = useNavigate();
  const groupId = Number(useParams().id);
  const group = useLoad(() => api.group(groupId), [groupId]);

  const [opponent, setOpponent] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    creatorSide: '',
    opponentSide: '',
    creatorPoints: '',
    opponentPoints: '',
    settleBy: '',
    details: '',
  });
  // Their stake follows yours until you ask for different odds, so an even
  // bet takes one number.
  const [customOdds, setCustomOdds] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (group.error) return <ErrorNote message={group.error} />;
  if (!group.data) return <Loading />;

  const others = group.data.members.filter((u) => u.id !== me.id);
  const isOpen = opponent === ANYONE;
  const opponentUser = others.find((u) => u.id === opponent);
  const theirPoints = customOdds ? form.opponentPoints : form.creatorPoints;
  const theirLabel = isOpen ? 'Whoever takes it' : (opponentUser?.displayName ?? 'They');

  const set = (field: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!opponent) {
      setError('Pick who you’re betting against, or put it up for anyone in the group.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { betId } = await api.createBet(groupId, {
        ...form,
        opponentPoints: theirPoints,
        opponentId: isOpen ? null : opponent,
      });
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
            <button
              type="button"
              className={`chip${isOpen ? ' selected' : ''}`}
              aria-pressed={isOpen}
              onClick={() => setOpponent(ANYONE)}
            >
              <OpenSeat size={22} /> Anyone in the group
            </button>
            {others.map((u) => (
              <button
                type="button"
                key={u.id}
                className={`chip${u.id === opponent ? ' selected' : ''}`}
                aria-pressed={u.id === opponent}
                onClick={() => setOpponent(u.id)}
              >
                <Avatar user={u} size={22} /> {u.displayName}
              </button>
            ))}
          </div>
          {isOpen && (
            <small className="muted hint">
              It goes on the group board. The first person to take it is your opponent.
            </small>
          )}
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
            {isOpen ? 'The other side' : opponentUser ? `${opponentUser.displayName}’s side` : 'Their side'}
            <input value={form.opponentSide} onChange={set('opponentSide')} placeholder="Bills win" required maxLength={120} />
          </label>
        </div>

        <label>
          You put up
          <div className="input-suffix">
            <input
              value={form.creatorPoints}
              onChange={set('creatorPoints')}
              inputMode="numeric"
              placeholder="10"
              required
            />
            <span>pts</span>
          </div>
          <div className="chips">
            {QUICK_POINTS.map((p) => (
              <button
                type="button"
                key={p}
                className={`chip${form.creatorPoints === String(p) ? ' selected' : ''}`}
                onClick={() => setForm((f) => ({ ...f, creatorPoints: String(p) }))}
              >
                {p}
              </button>
            ))}
          </div>
        </label>

        {customOdds ? (
          <label>
            {theirLabel} {isOpen || opponentUser ? 'puts' : 'put'} up
            <div className="input-suffix">
              <input
                value={form.opponentPoints}
                onChange={set('opponentPoints')}
                inputMode="numeric"
                placeholder="50"
                required
              />
              <span>pts</span>
            </div>
          </label>
        ) : null}

        <div className="odds">
          <OddsSummary mine={form.creatorPoints} theirs={theirPoints} />
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              if (!customOdds) setForm((f) => ({ ...f, opponentPoints: f.creatorPoints }));
              setCustomOdds(!customOdds);
            }}
          >
            {customOdds ? 'Make it even' : 'Offer different odds'}
          </button>
        </div>

        <label>
          <span>
            Settle by <span className="muted">(optional)</span>
          </span>
          <input type="date" value={form.settleBy} onChange={set('settleBy')} />
        </label>

        <label>
          <span>
            Fine print <span className="muted">(optional)</span>
          </span>
          <textarea
            value={form.details}
            onChange={set('details')}
            rows={3}
            maxLength={1000}
            placeholder="Overtime counts. Loser posts a photo in a Bills jersey."
          />
        </label>

        <ErrorNote message={error} />
        <button className="btn primary" disabled={busy}>
          {isOpen ? 'Put it on the board' : opponentUser ? `Send bet to ${opponentUser.displayName}` : 'Send bet'}
        </button>
      </form>
    </>
  );
}

// Spells out what the stakes mean, so uneven odds are hard to get backwards.
function OddsSummary({ mine, theirs }: { mine: string; theirs: string }) {
  const m = Number(mine);
  const t = Number(theirs);
  if (!mine || !theirs || !Number.isInteger(m) || !Number.isInteger(t) || m < 1 || t < 1) {
    return <p className="muted small">Points are just for bragging rights. They aren&rsquo;t worth any money.</p>;
  }
  if (m === t) return <p className="small">Even bet: the winner takes {formatPoints(m)}.</p>;
  return (
    <p className="small">
      You risk <strong>{formatPoints(m)}</strong> to win <strong>{formatPoints(t)}</strong>.{' '}
      <span className="muted">{m < t ? 'Good when your side is the long shot.' : 'Good when your side is the favorite.'}</span>
    </p>
  );
}
