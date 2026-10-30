// Bet rules the UI needs to know about: who won, which buttons to show, what's
// waiting on the viewer, and how points move. The database (bet_action in
// supabase/migrations) enforces the same rules. This copy only decides what to
// display.
import type { Bet, BetAction, BetStatus, LeaderboardRow, Outcome, User } from './api';

type BetFacts = {
  status: BetStatus;
  outcome: Outcome | null;
  outcomeReportedBy: string | null;
  proposedBy: string | null;
  counters: number;
  settleBy: string | null;
  creatorId: string;
  opponentId: string | null;
};

export function winnerOf(b: BetFacts): string | null {
  if (b.status !== 'settled') return null;
  if (b.outcome === 'creator') return b.creatorId;
  if (b.outcome === 'opponent') return b.opponentId;
  return null;
}

export function loserOf(b: BetFacts): string | null {
  const w = winnerOf(b);
  if (w === null) return null;
  return w === b.creatorId ? b.opponentId : b.creatorId;
}

export function allowedActions(b: BetFacts, viewerId: string): BetAction[] {
  // Open bets sit on the group board: anyone else in the group can take one,
  // or counter it with different terms.
  if (b.status === 'open') return viewerId === b.creatorId ? ['cancel'] : ['take', 'counter'];

  const isCreator = viewerId === b.creatorId;
  const isOpponent = viewerId === b.opponentId;
  if (!isCreator && !isOpponent) return [];

  switch (b.status) {
    case 'proposed': {
      // Whoever didn't make the offer on the table answers it.
      const myTurn = (b.proposedBy ?? b.creatorId) !== viewerId;
      if (myTurn) return ['accept', 'counter', 'decline'];
      return isCreator ? ['cancel'] : [];
    }
    case 'active':
    case 'disputed':
      return ['report'];
    case 'reported':
      return b.outcomeReportedBy === viewerId ? [] : ['confirm', 'dispute'];
    default:
      return [];
  }
}

// The thing the viewer should do next on this bet, if anything. Drives the
// "Your move" list on the home screen. (Open bets get their own list.)
export function todoFor(b: BetFacts, viewerId: string): string | null {
  const actions = allowedActions(b, viewerId);
  switch (b.status) {
    case 'proposed':
      if (!actions.includes('accept')) return null;
      return b.counters > 0 ? 'Answer the counter' : 'Accept, counter or decline';
    case 'active': {
      const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
      return actions.length && b.settleBy && b.settleBy <= today ? 'Report the result' : null;
    }
    case 'disputed':
      return actions.length ? 'Result disputed — report it again' : null;
    case 'reported':
      return actions.includes('confirm') ? 'Confirm the result' : null;
    default:
      return null;
  }
}

// Each side puts up its own stake, and the winner collects the loser's. So
// with 10 vs 50, the creator risks 10 to win 50.
export function stakeOf(b: Bet, userId: string): number {
  return userId === b.creator.id ? b.creatorPoints : b.opponentPoints;
}

export function otherStake(b: Bet, userId: string): number {
  return userId === b.creator.id ? b.opponentPoints : b.creatorPoints;
}

export function isEven(b: Pick<Bet, 'creatorPoints' | 'opponentPoints'>): boolean {
  return b.creatorPoints === b.opponentPoints;
}

// ---------- Choosing stakes (the new-bet wheels) ----------

export const MAX_STAKE = 1000;

function steps(from: number, to: number, by: number): number[] {
  const out: number[] = [];
  for (let n = from; n <= to; n += by) out.push(n);
  return out;
}

// Every point up to 20, then coarser steps up to the 1,000 the database allows.
export const STAKE_OPTIONS: number[] = [...steps(1, 20, 1), ...steps(25, 100, 5), ...steps(110, 200, 10), ...steps(250, MAX_STAKE, 50)];

// "5 to 1": they put up 5 for every 1 you put up (your side is the long shot).
// "1 to 5": you put up 5 for every 1 of theirs (your side is the favorite).
export type Odds = { label: string; theirs: number; yours: number };

export const ODDS_OPTIONS: Odds[] = [
  ...[10, 9, 8, 7, 6, 5, 4, 3, 2].map((n) => ({ label: `1 to ${n}`, theirs: 1, yours: n })),
  { label: '2 to 3', theirs: 2, yours: 3 },
  { label: 'Even', theirs: 1, yours: 1 },
  { label: '3 to 2', theirs: 3, yours: 2 },
  ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ label: `${n} to 1`, theirs: n, yours: 1 })),
];

export const EVEN_ODDS_INDEX = ODDS_OPTIONS.findIndex((o) => o.label === 'Even');

// What the other side puts up at these odds, in whole points within 1-1,000.
// `exact` is false when rounding or the limits changed the ratio.
export function theirStake(mine: number, odds: Odds): { points: number; exact: boolean } {
  const raw = (mine * odds.theirs) / odds.yours;
  const points = Math.min(MAX_STAKE, Math.max(1, Math.round(raw)));
  return { points, exact: points === raw };
}

// Points this settled bet moved for a user: plus the loser's stake for the
// winner, minus their own stake for the loser, null for anyone else.
export function netFor(b: Bet, userId: string): number | null {
  if (b.winnerId === null || b.loserId === null) return null;
  if (userId === b.winnerId) return stakeOf(b, b.loserId);
  if (userId === b.loserId) return -stakeOf(b, userId);
  return null;
}

// Net points and record per member, across every settled bet in the group.
export function leaderboard(members: User[], bets: Bet[]): LeaderboardRow[] {
  const stats = new Map(members.map((u) => [u.id, { net: 0, wins: 0, losses: 0, pushes: 0 }]));
  for (const b of bets) {
    if (b.status !== 'settled' || !b.opponent) continue;
    if (b.winnerId === null || b.loserId === null) {
      for (const id of [b.creator.id, b.opponent.id]) {
        const s = stats.get(id);
        if (s) s.pushes++;
      }
      continue;
    }
    const ws = stats.get(b.winnerId);
    const ls = stats.get(b.loserId);
    if (ws) {
      ws.net += netFor(b, b.winnerId)!;
      ws.wins++;
    }
    if (ls) {
      ls.net += netFor(b, b.loserId)!;
      ls.losses++;
    }
  }
  return members
    .map((u) => ({ user: u, ...stats.get(u.id)! }))
    .sort((a, b) => b.net - a.net || b.wins - a.wins);
}
