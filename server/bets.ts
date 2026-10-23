import { db, type BetRow, type Outcome, type UserRow } from './db.js';
import { HttpError } from './http.js';

export type PublicUser = {
  id: number;
  username: string;
  displayName: string;
  venmoUsername: string;
};

export function publicUser(u: UserRow): PublicUser {
  return { id: u.id, username: u.username, displayName: u.display_name, venmoUsername: u.venmo_username };
}

export function loadUsers(ids: Iterable<number>): Map<number, PublicUser> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = db
    .prepare(`SELECT * FROM users WHERE id IN (${unique.map(() => '?').join(',')})`)
    .all(...unique) as UserRow[];
  return new Map(rows.map((u) => [u.id, publicUser(u)]));
}

export function winnerId(b: BetRow): number | null {
  if (b.status !== 'settled') return null;
  if (b.outcome === 'creator') return b.creator_id;
  if (b.outcome === 'opponent') return b.opponent_id;
  return null;
}

export function loserId(b: BetRow): number | null {
  const w = winnerId(b);
  if (w === null) return null;
  return w === b.creator_id ? b.opponent_id : b.creator_id;
}

export type BetAction = 'accept' | 'decline' | 'cancel' | 'report' | 'confirm' | 'dispute' | 'requested' | 'paid';

export function allowedActions(b: BetRow, viewerId: number): BetAction[] {
  const isCreator = viewerId === b.creator_id;
  const isOpponent = viewerId === b.opponent_id;
  if (!isCreator && !isOpponent) return [];

  switch (b.status) {
    case 'proposed':
      return isOpponent ? ['accept', 'decline'] : ['cancel'];
    case 'active':
    case 'disputed':
      return ['report'];
    case 'reported':
      return b.outcome_reported_by === viewerId ? [] : ['confirm', 'dispute'];
    case 'settled': {
      const winner = winnerId(b);
      if (winner === null || b.paid_at) return [];
      return winner === viewerId ? ['requested', 'paid'] : ['paid'];
    }
    default:
      return [];
  }
}

// The thing the viewer should do next on this bet, if anything. Drives the
// "Your move" list on the home screen.
export function todo(b: BetRow, viewerId: number): string | null {
  const actions = allowedActions(b, viewerId);
  switch (b.status) {
    case 'proposed':
      return actions.includes('accept') ? 'Accept or decline' : null;
    case 'active': {
      const today = new Date().toISOString().slice(0, 10);
      return b.settle_by && b.settle_by <= today ? 'Report the result' : null;
    }
    case 'disputed':
      return actions.length ? 'Result disputed — report it again' : null;
    case 'reported':
      return actions.includes('confirm') ? 'Confirm the result' : null;
    case 'settled':
      if (!actions.length) return null;
      if (winnerId(b) === viewerId) return b.requested_at ? null : 'Request your money on Venmo';
      return 'Pay up on Venmo';
    default:
      return null;
  }
}

export function serializeBet(b: BetRow, viewerId: number, users: Map<number, PublicUser>, groupName?: string) {
  return {
    id: b.id,
    groupId: b.group_id,
    groupName,
    title: b.title,
    details: b.details,
    creatorSide: b.creator_side,
    opponentSide: b.opponent_side,
    amountCents: b.amount_cents,
    settleBy: b.settle_by,
    status: b.status,
    outcome: b.outcome,
    outcomeReportedBy: b.outcome_reported_by,
    requestedAt: b.requested_at,
    paidAt: b.paid_at,
    paidMarkedBy: b.paid_marked_by,
    createdAt: b.created_at,
    acceptedAt: b.accepted_at,
    settledAt: b.settled_at,
    creator: users.get(b.creator_id)!,
    opponent: users.get(b.opponent_id)!,
    winnerId: winnerId(b),
    loserId: loserId(b),
    actions: allowedActions(b, viewerId),
    todo: todo(b, viewerId),
  };
}

export function serializeBets(rows: (BetRow & { group_name?: string })[], viewerId: number) {
  const users = loadUsers(rows.flatMap((b) => [b.creator_id, b.opponent_id]));
  return rows.map((b) => serializeBet(b, viewerId, users, b.group_name));
}

type ReportBody = { winner?: unknown };

// Applies a state change to a bet on behalf of one of its two participants.
// Every UPDATE re-checks the status it expects, so two people tapping buttons
// at the same moment can't both win the race.
export function applyAction(bet: BetRow, viewerId: number, action: string, body: ReportBody): void {
  if (!allowedActions(bet, viewerId).includes(action as BetAction)) {
    throw new HttpError(409, 'That action isn’t available on this bet right now.');
  }
  const viewerRole: Outcome = viewerId === bet.creator_id ? 'creator' : 'opponent';
  const otherRole: Outcome = viewerRole === 'creator' ? 'opponent' : 'creator';

  let result;
  switch (action as BetAction) {
    case 'accept':
      result = db
        .prepare(`UPDATE bets SET status = 'active', accepted_at = datetime('now') WHERE id = ? AND status = 'proposed'`)
        .run(bet.id);
      break;
    case 'decline':
      result = db.prepare(`UPDATE bets SET status = 'declined' WHERE id = ? AND status = 'proposed'`).run(bet.id);
      break;
    case 'cancel':
      result = db.prepare(`UPDATE bets SET status = 'cancelled' WHERE id = ? AND status = 'proposed'`).run(bet.id);
      break;
    case 'report': {
      const claim = body.winner;
      if (claim !== 'me' && claim !== 'them' && claim !== 'push') {
        throw new HttpError(400, 'Say who won: me, them or push.');
      }
      const outcome: Outcome = claim === 'me' ? viewerRole : claim === 'them' ? otherRole : 'push';
      if (claim === 'them') {
        // Conceding needs no confirmation from the winner.
        result = db
          .prepare(
            `UPDATE bets SET status = 'settled', outcome = ?, outcome_reported_by = ?, settled_at = datetime('now')
             WHERE id = ? AND status IN ('active', 'disputed')`,
          )
          .run(outcome, viewerId, bet.id);
      } else {
        result = db
          .prepare(
            `UPDATE bets SET status = 'reported', outcome = ?, outcome_reported_by = ?
             WHERE id = ? AND status IN ('active', 'disputed')`,
          )
          .run(outcome, viewerId, bet.id);
      }
      break;
    }
    case 'confirm':
      result = db
        .prepare(`UPDATE bets SET status = 'settled', settled_at = datetime('now') WHERE id = ? AND status = 'reported'`)
        .run(bet.id);
      break;
    case 'dispute':
      result = db.prepare(`UPDATE bets SET status = 'disputed' WHERE id = ? AND status = 'reported'`).run(bet.id);
      break;
    case 'requested':
      result = db
        .prepare(
          `UPDATE bets SET requested_at = COALESCE(requested_at, datetime('now'))
           WHERE id = ? AND status = 'settled' AND paid_at IS NULL`,
        )
        .run(bet.id);
      break;
    case 'paid':
      result = db
        .prepare(
          `UPDATE bets SET paid_at = datetime('now'), paid_marked_by = ?
           WHERE id = ? AND status = 'settled' AND paid_at IS NULL`,
        )
        .run(viewerId, bet.id);
      break;
  }
  if (!result || result.changes !== 1) {
    throw new HttpError(409, 'This bet just changed. Refresh and try again.');
  }
}
