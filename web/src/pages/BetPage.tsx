import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { api, type Bet, type BetAction, type BetDetail, type Comment, type User } from '../api';
import { useMe } from '../auth';
import { Avatar, ErrorNote, Loading, Section, StatusPill, useLoad } from '../components';
import { formatDate, formatPoints, timeAgo } from '../format';

type Act = (action: BetAction, body?: { winner: 'me' | 'them' | 'push' }) => Promise<void>;

export function BetPage() {
  const me = useMe();
  const betId = Number(useParams().id);
  const { data, error, setData } = useLoad(() => api.bet(betId), [betId]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;
  const { bet, comments } = data;

  const act: Act = async (action, body) => {
    setBusy(true);
    setActionError(null);
    try {
      setData(await api.betAction(betId, action, body));
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Link to={`/groups/${bet.groupId}`} className="back">
        &lsaquo; {bet.groupName}
      </Link>

      <div className="card bet-hero">
        <div className="bet-hero-head">
          <span className="bet-hero-amount">{formatPoints(bet.points)}</span>
          <StatusPill bet={bet} />
        </div>
        <h1 className="bet-hero-title">{bet.title}</h1>
        <div className="sides-display">
          <SideCard user={bet.creator} side={bet.creatorSide} bet={bet} meId={me.id} />
          <span className="vs">vs</span>
          <SideCard user={bet.opponent} side={bet.opponentSide} bet={bet} meId={me.id} />
        </div>
        {bet.details && <p className="fine-print">{bet.details}</p>}
        <p className="muted small">
          Proposed by {bet.creator.displayName} {timeAgo(bet.createdAt)}
          {bet.settleBy && ` · settles by ${formatDate(bet.settleBy)}`}
        </p>
      </div>

      <StatusPanel bet={bet} me={me} act={act} busy={busy} />
      <ErrorNote message={actionError} />

      <Chatter betId={bet.id} comments={comments} onUpdate={setData} />
    </>
  );
}

function SideCard({ user, side, bet, meId }: { user: User; side: string; bet: Bet; meId: string }) {
  const isWinner = bet.winnerId === user.id;
  return (
    <div className={`side-card${isWinner ? ' winner' : ''}`}>
      <Avatar user={user} size={40} />
      <div className="side-name">{user.id === meId ? 'You' : user.displayName}</div>
      <div className="side-pick">{side}</div>
      {isWinner && <div className="winner-badge">Winner</div>}
    </div>
  );
}

function nameFor(user: User, meId: string) {
  return user.id === meId ? 'You' : user.displayName;
}

// "Sam says they won." / "You said Sam won." / "Sam called it a push."
function describeReport(bet: Bet, reporter: User, meId: string): string {
  const who = nameFor(reporter, meId);
  if (bet.outcome === 'push') return `${who} called it a push.`;
  const winner = bet.outcome === 'creator' ? bet.creator : bet.opponent;
  const verb = reporter.id === meId ? 'said' : 'says';
  if (winner.id === reporter.id) return `${who} ${verb} ${reporter.id === meId ? 'you' : 'they'} won.`;
  return `${who} ${verb} ${winner.id === meId ? 'you' : winner.displayName} won.`;
}

function StatusPanel({ bet, me, act, busy }: { bet: Bet; me: User; act: Act; busy: boolean }) {
  const isCreator = bet.creator.id === me.id;
  const isParticipant = isCreator || bet.opponent.id === me.id;
  const other = isCreator ? bet.opponent : bet.creator;
  const can = (a: BetAction) => bet.actions.includes(a);

  switch (bet.status) {
    case 'proposed':
      if (can('accept')) {
        return (
          <div className="card panel">
            <p>
              <strong>{bet.creator.displayName}</strong> bet you {formatPoints(bet.points)}. You&rsquo;d have:{' '}
              <strong>{bet.opponentSide}</strong>.
            </p>
            <div className="button-row">
              <button className="btn primary" disabled={busy} onClick={() => act('accept')}>
                Accept bet
              </button>
              <button className="btn" disabled={busy} onClick={() => act('decline')}>
                Decline
              </button>
            </div>
          </div>
        );
      }
      return (
        <div className="card panel">
          <p>Waiting for {bet.opponent.displayName} to accept.</p>
          {can('cancel') && (
            <button className="btn subtle" disabled={busy} onClick={() => act('cancel')}>
              Cancel bet
            </button>
          )}
        </div>
      );

    case 'active':
    case 'disputed':
      if (!isParticipant) {
        return (
          <div className="card panel">
            <p>{bet.status === 'disputed' ? 'The result is disputed.' : 'This bet is live.'}</p>
          </div>
        );
      }
      return (
        <div className="card panel">
          {bet.status === 'disputed' ? (
            <p>
              <strong>The result was disputed.</strong> Talk it out below, then report what actually happened.
            </p>
          ) : (
            <p>
              <strong>Bet&rsquo;s on.</strong> When it&rsquo;s decided, report who won. {other.displayName} confirms
              before it settles.
            </p>
          )}
          <div className="button-row">
            <button className="btn primary" disabled={busy} onClick={() => act('report', { winner: 'me' })}>
              I won
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`This settles the bet. ${other.displayName} gets ${formatPoints(bet.points)}.`)) {
                  act('report', { winner: 'them' });
                }
              }}
            >
              {other.displayName} won
            </button>
            <button className="btn subtle" disabled={busy} onClick={() => act('report', { winner: 'push' })}>
              Push
            </button>
          </div>
        </div>
      );

    case 'reported': {
      const reporter = bet.outcomeReportedBy === bet.creator.id ? bet.creator : bet.opponent;
      const confirmer = reporter.id === bet.creator.id ? bet.opponent : bet.creator;
      return (
        <div className="card panel">
          <p>
            <strong>{describeReport(bet, reporter, me.id)}</strong>{' '}
            {can('confirm') ? 'Is that right?' : `Waiting for ${confirmer.displayName} to confirm.`}
          </p>
          {can('confirm') && (
            <div className="button-row">
              <button className="btn primary" disabled={busy} onClick={() => act('confirm')}>
                Confirm
              </button>
              <button className="btn" disabled={busy} onClick={() => act('dispute')}>
                Dispute
              </button>
            </div>
          )}
        </div>
      );
    }

    case 'settled':
      if (bet.outcome === 'push') {
        return (
          <div className="card panel">
            <p>
              <strong>Push.</strong> Nobody gains or loses points.
            </p>
          </div>
        );
      }
      return <ResultPanel bet={bet} me={me} />;

    case 'declined':
      return (
        <div className="card panel muted">
          <p>{nameFor(bet.opponent, me.id)} declined this bet.</p>
        </div>
      );
    case 'cancelled':
      return (
        <div className="card panel muted">
          <p>{nameFor(bet.creator, me.id)} cancelled this bet.</p>
        </div>
      );
  }
}

// The final word on a settled bet, from the viewer's side of it.
function ResultPanel({ bet, me }: { bet: Bet; me: User }) {
  const winner = bet.winnerId === bet.creator.id ? bet.creator : bet.opponent;
  const loser = winner.id === bet.creator.id ? bet.opponent : bet.creator;
  const points = formatPoints(bet.points);
  const settled = bet.settledAt && <p className="muted small">Settled {timeAgo(bet.settledAt)}</p>;

  if (me.id === winner.id) {
    return (
      <div className="card panel result-panel won">
        <h2>You won {points} 🎉</h2>
        <p>{loser.displayName} owes you bragging rights.</p>
        {settled}
      </div>
    );
  }
  if (me.id === loser.id) {
    return (
      <div className="card panel result-panel">
        <h2>{winner.displayName} took this one</h2>
        <p>You lost {points}. Win them back.</p>
        {settled}
      </div>
    );
  }
  return (
    <div className="card panel result-panel">
      <p>
        <strong>{winner.displayName}</strong> won {points} from {loser.displayName}.
      </p>
      {settled}
    </div>
  );
}

function Chatter({
  betId,
  comments,
  onUpdate,
}: {
  betId: number;
  comments: Comment[];
  onUpdate: (d: BetDetail) => void;
}) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onUpdate(await api.comment(betId, body));
      setBody('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Chatter">
      {comments.length === 0 ? (
        <p className="empty">No comments yet. Talk a little trash.</p>
      ) : (
        <div className="comments">
          {comments.map((c) => (
            <div key={c.id} className="comment">
              <Avatar user={c.user} size={28} />
              <div>
                <div className="comment-head">
                  <strong>{c.user.displayName}</strong> <span className="muted small">{timeAgo(c.createdAt)}</span>
                </div>
                <div className="comment-body">{c.body}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <form className="inline-form" onSubmit={submit}>
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Say something…" maxLength={500} required />
        <button className="btn primary" disabled={busy}>
          Send
        </button>
      </form>
      <ErrorNote message={error} />
    </Section>
  );
}
