import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Bet, User } from './api';
import { netFor } from './bets';
import { formatSignedPoints, formatStakes, timeAgo } from './format';

// Loads data on mount (and when deps change), with a reload function and a
// setter so mutations can swap in the fresh copy the API returns.
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => {
    setError(null);
    return load()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, reload, setData };
}

export function Loading() {
  return <div className="loading" aria-label="Loading" />;
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="error" role="alert">
      {message}
    </p>
  );
}

const AVATAR_HUES = [152, 200, 265, 330, 20, 45, 180, 290];

export function Avatar({ user, size = 36 }: { user: User; size?: number }) {
  const initials = user.displayName
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  let hash = 0;
  for (const ch of user.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = AVATAR_HUES[hash % AVATAR_HUES.length];
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hue} 55% 45%)` }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

// Stands in for the opponent of an open bet nobody has taken yet.
export function OpenSeat({ size = 36 }: { size?: number }) {
  return (
    <span className="avatar open-seat" style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden="true">
      ?
    </span>
  );
}

export function statusLabel(bet: Bet): { text: string; tone: 'pending' | 'live' | 'alert' | 'done' | 'muted' } {
  switch (bet.status) {
    case 'open':
      return { text: 'Up for grabs', tone: 'live' };
    case 'proposed':
      return { text: 'Waiting to accept', tone: 'pending' };
    case 'active':
      return { text: 'Live', tone: 'live' };
    case 'reported':
      return { text: 'Result reported', tone: 'pending' };
    case 'disputed':
      return { text: 'Disputed', tone: 'alert' };
    case 'settled':
      return bet.outcome === 'push' ? { text: 'Push', tone: 'muted' } : { text: 'Final', tone: 'done' };
    case 'declined':
      return { text: 'Declined', tone: 'muted' };
    case 'cancelled':
      return { text: 'Cancelled', tone: 'muted' };
  }
}

export function StatusPill({ bet }: { bet: Bet }) {
  const { text, tone } = statusLabel(bet);
  return <span className={`pill pill-${tone}`}>{text}</span>;
}

export function BetCard({ bet, meId, showGroup }: { bet: Bet; meId: string; showGroup?: boolean }) {
  // Once settled, show what the bet did to my score; until then, the stakes.
  const net = netFor(bet, meId);
  return (
    <Link to={`/bets/${bet.id}`} className={`card bet-card${bet.todo ? ' needs-action' : ''}`}>
      <div className="bet-card-top">
        <span className="matchup">
          <Avatar user={bet.creator} size={24} />
          {bet.opponent ? <Avatar user={bet.opponent} size={24} /> : <OpenSeat size={24} />}
          <span>
            {bet.creator.displayName} vs {bet.opponent?.displayName ?? 'anyone'}
          </span>
        </span>
        {net === null ? (
          <span className="amount">{formatStakes(bet.creatorPoints, bet.opponentPoints)}</span>
        ) : (
          <span className={`amount ${net > 0 ? 'won' : 'lost'}`}>{formatSignedPoints(net)} pts</span>
        )}
      </div>
      <div className="bet-card-title">{bet.title}</div>
      <div className="bet-card-meta">
        <StatusPill bet={bet} />
        {showGroup && bet.groupName && <span className="muted">{bet.groupName}</span>}
        <span className="muted">{timeAgo(bet.createdAt)}</span>
      </div>
      {bet.todo && <div className="todo">{bet.todo} &rarr;</div>}
    </Link>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
