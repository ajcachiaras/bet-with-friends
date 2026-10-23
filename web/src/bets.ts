// Bet rules the UI needs to know about: who won, which buttons to show, and
// what's waiting on the viewer. The database (bet_action in
// supabase/schema.sql) enforces the same rules. This copy only decides what to
// display.
import type { BetAction, BetStatus, Outcome } from './api';

type BetFacts = {
  status: BetStatus;
  outcome: Outcome | null;
  outcomeReportedBy: string | null;
  settleBy: string | null;
  creatorId: string;
  opponentId: string;
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
  const isCreator = viewerId === b.creatorId;
  const isOpponent = viewerId === b.opponentId;
  if (!isCreator && !isOpponent) return [];

  switch (b.status) {
    case 'proposed':
      return isOpponent ? ['accept', 'decline'] : ['cancel'];
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
// "Your move" list on the home screen.
export function todoFor(b: BetFacts, viewerId: string): string | null {
  const actions = allowedActions(b, viewerId);
  switch (b.status) {
    case 'proposed':
      return actions.includes('accept') ? 'Accept or decline' : null;
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
