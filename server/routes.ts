import crypto from 'node:crypto';
import { Router } from 'express';
import { endSession, hashPassword, requireUser, startSession, verifyPassword } from './auth.js';
import { applyAction, loadUsers, publicUser, serializeBet, serializeBets, winnerId, loserId } from './bets.js';
import { db, type BetRow, type CommentRow, type GroupRow, type UserRow } from './db.js';
import * as v from './http.js';
import { HttpError } from './http.js';

export const api = Router();

// ---------- Accounts ----------

api.post('/auth/signup', (req, res) => {
  const username = v.username(req.body.username);
  const displayName = v.str(req.body.displayName, 'Name', { max: 40 });
  const venmoUsername = v.venmoUsername(req.body.venmoUsername);
  const password = v.str(req.body.password, 'Password', { min: 8, max: 200 });

  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    throw new HttpError(409, 'That username is taken.');
  }
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, display_name, venmo_username, password_hash) VALUES (?, ?, ?, ?)')
    .run(username, displayName, venmoUsername, hashPassword(password));
  startSession(res, Number(lastInsertRowid));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid) as UserRow;
  res.status(201).json({ user: publicUser(user) });
});

api.post('/auth/login', (req, res) => {
  const username = String(req.body.username ?? '').trim().replace(/^@/, '');
  const password = String(req.body.password ?? '');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new HttpError(401, 'Wrong username or password.');
  }
  startSession(res, user.id);
  res.json({ user: publicUser(user) });
});

api.post('/auth/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

api.get('/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

api.patch('/me', (req, res) => {
  const me = requireUser(req);
  const displayName = req.body.displayName === undefined ? me.display_name : v.str(req.body.displayName, 'Name', { max: 40 });
  const venmoUsername =
    req.body.venmoUsername === undefined ? me.venmo_username : v.venmoUsername(req.body.venmoUsername);
  db.prepare('UPDATE users SET display_name = ?, venmo_username = ? WHERE id = ?').run(displayName, venmoUsername, me.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(me.id) as UserRow;
  res.json({ user: publicUser(user) });
});

// ---------- Groups ----------

const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newInviteCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) code += INVITE_ALPHABET[crypto.randomInt(INVITE_ALPHABET.length)];
    if (!db.prepare('SELECT 1 FROM bet_groups WHERE invite_code = ?').get(code)) return code;
  }
}

function requireMembership(groupId: number, userId: number): GroupRow {
  const group = db
    .prepare(
      `SELECT g.* FROM bet_groups g JOIN group_members m ON m.group_id = g.id
       WHERE g.id = ? AND m.user_id = ?`,
    )
    .get(groupId, userId) as GroupRow | undefined;
  if (!group) throw new HttpError(404, 'Group not found.');
  return group;
}

api.get('/groups', (req, res) => {
  const me = requireUser(req);
  const groups = db
    .prepare(
      `SELECT g.id, g.name, g.invite_code,
         (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count,
         (SELECT COUNT(*) FROM bets WHERE group_id = g.id AND status IN ('active', 'reported', 'disputed')) AS live_bets
       FROM bet_groups g JOIN group_members m ON m.group_id = g.id
       WHERE m.user_id = ?
       ORDER BY m.joined_at DESC`,
    )
    .all(me.id) as { id: number; name: string; invite_code: string; member_count: number; live_bets: number }[];
  res.json({
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      inviteCode: g.invite_code,
      memberCount: g.member_count,
      liveBets: g.live_bets,
    })),
  });
});

api.post('/groups', (req, res) => {
  const me = requireUser(req);
  const name = v.str(req.body.name, 'Group name', { max: 50 });
  const create = db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO bet_groups (name, invite_code, created_by) VALUES (?, ?, ?)')
      .run(name, newInviteCode(), me.id);
    db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(lastInsertRowid, me.id);
    return Number(lastInsertRowid);
  });
  res.status(201).json({ groupId: create() });
});

api.post('/groups/join', (req, res) => {
  const me = requireUser(req);
  const code = String(req.body.code ?? '').trim().toUpperCase();
  const group = db.prepare('SELECT * FROM bet_groups WHERE invite_code = ?').get(code) as GroupRow | undefined;
  if (!group) throw new HttpError(404, 'No group with that invite code.');
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)').run(group.id, me.id);
  res.json({ groupId: group.id });
});

api.get('/groups/:id', (req, res) => {
  const me = requireUser(req);
  const group = requireMembership(v.id(req.params.id), me.id);

  const memberRows = db
    .prepare(
      `SELECT u.* FROM users u JOIN group_members m ON m.user_id = u.id
       WHERE m.group_id = ? ORDER BY m.joined_at`,
    )
    .all(group.id) as UserRow[];
  const betRows = db
    .prepare('SELECT * FROM bets WHERE group_id = ? ORDER BY created_at DESC, id DESC LIMIT 200')
    .all(group.id) as BetRow[];

  // Net winnings and record per member, across every settled bet in the group.
  const stats = new Map(memberRows.map((u) => [u.id, { net: 0, wins: 0, losses: 0, pushes: 0 }]));
  for (const b of betRows) {
    if (b.status !== 'settled') continue;
    const w = winnerId(b);
    const l = loserId(b);
    if (w === null || l === null) {
      for (const uid of [b.creator_id, b.opponent_id]) {
        const s = stats.get(uid);
        if (s) s.pushes++;
      }
      continue;
    }
    const ws = stats.get(w);
    const ls = stats.get(l);
    if (ws) {
      ws.net += b.amount_cents;
      ws.wins++;
    }
    if (ls) {
      ls.net -= b.amount_cents;
      ls.losses++;
    }
  }

  const members = memberRows.map(publicUser);
  res.json({
    group: { id: group.id, name: group.name, inviteCode: group.invite_code, createdBy: group.created_by },
    members,
    leaderboard: members
      .map((u) => ({ user: u, ...stats.get(u.id)! }))
      .sort((a, b) => b.net - a.net || b.wins - a.wins),
    bets: serializeBets(betRows, me.id),
  });
});

// ---------- Bets ----------

api.post('/groups/:id/bets', (req, res) => {
  const me = requireUser(req);
  const group = requireMembership(v.id(req.params.id), me.id);
  const opponentId = Number(req.body.opponentId);
  if (opponentId === me.id) throw new HttpError(400, 'You can’t bet against yourself.');
  const isMember = db
    .prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(group.id, opponentId);
  if (!isMember) throw new HttpError(400, 'Pick someone in this group to bet against.');

  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO bets (group_id, creator_id, opponent_id, title, details, creator_side, opponent_side, amount_cents, settle_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      group.id,
      me.id,
      opponentId,
      v.str(req.body.title, 'What’s the bet', { max: 120 }),
      v.optionalStr(req.body.details, 'Details', 1000),
      v.str(req.body.creatorSide, 'Your side', { max: 120 }),
      v.str(req.body.opponentSide, 'Their side', { max: 120 }),
      v.amountCents(req.body.amount),
      v.optionalDate(req.body.settleBy),
    );
  res.status(201).json({ betId: Number(lastInsertRowid) });
});

// Bets across all of my groups, newest first.
api.get('/me/bets', (req, res) => {
  const me = requireUser(req);
  const rows = db
    .prepare(
      `SELECT b.*, g.name AS group_name FROM bets b JOIN bet_groups g ON g.id = b.group_id
       WHERE b.creator_id = ? OR b.opponent_id = ?
       ORDER BY b.created_at DESC, b.id DESC LIMIT 200`,
    )
    .all(me.id, me.id) as (BetRow & { group_name: string })[];
  res.json({ bets: serializeBets(rows, me.id) });
});

function loadBetForMember(betId: number, userId: number): BetRow & { group_name: string } {
  const bet = db
    .prepare(
      `SELECT b.*, g.name AS group_name FROM bets b
       JOIN bet_groups g ON g.id = b.group_id
       JOIN group_members m ON m.group_id = b.group_id AND m.user_id = ?
       WHERE b.id = ?`,
    )
    .get(userId, betId) as (BetRow & { group_name: string }) | undefined;
  if (!bet) throw new HttpError(404, 'Bet not found.');
  return bet;
}

function betResponse(betId: number, viewerId: number) {
  const bet = loadBetForMember(betId, viewerId);
  const comments = db
    .prepare('SELECT * FROM comments WHERE bet_id = ? ORDER BY created_at, id')
    .all(bet.id) as CommentRow[];
  const users = loadUsers([bet.creator_id, bet.opponent_id, ...comments.map((c) => c.user_id)]);
  return {
    bet: serializeBet(bet, viewerId, users, bet.group_name),
    comments: comments.map((c) => ({ id: c.id, body: c.body, createdAt: c.created_at, user: users.get(c.user_id)! })),
  };
}

api.get('/bets/:id', (req, res) => {
  const me = requireUser(req);
  res.json(betResponse(v.id(req.params.id), me.id));
});

api.post('/bets/:id/actions/:action', (req, res) => {
  const me = requireUser(req);
  const bet = loadBetForMember(v.id(req.params.id), me.id);
  applyAction(bet, me.id, req.params.action, req.body ?? {});
  res.json(betResponse(bet.id, me.id));
});

api.post('/bets/:id/comments', (req, res) => {
  const me = requireUser(req);
  const bet = loadBetForMember(v.id(req.params.id), me.id);
  db.prepare('INSERT INTO comments (bet_id, user_id, body) VALUES (?, ?, ?)').run(
    bet.id,
    me.id,
    v.str(req.body.body, 'Comment', { max: 500 }),
  );
  res.status(201).json(betResponse(bet.id, me.id));
});
