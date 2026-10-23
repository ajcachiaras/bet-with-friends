import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = process.env.DATA_DIR ?? path.resolve('data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'bets.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY,
    username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name    TEXT NOT NULL,
    venmo_username  TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bet_groups (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    invite_code  TEXT NOT NULL UNIQUE,
    created_by   INTEGER NOT NULL REFERENCES users(id),
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS group_members (
    group_id   INTEGER NOT NULL REFERENCES bet_groups(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (group_id, user_id)
  );

  -- status: proposed -> active -> reported -> settled
  --         proposed -> declined | cancelled;  reported -> disputed -> reported
  -- outcome: 'creator' | 'opponent' | 'push' (the reported result while
  -- status = 'reported', the final result once settled)
  CREATE TABLE IF NOT EXISTS bets (
    id                   INTEGER PRIMARY KEY,
    group_id             INTEGER NOT NULL REFERENCES bet_groups(id) ON DELETE CASCADE,
    creator_id           INTEGER NOT NULL REFERENCES users(id),
    opponent_id          INTEGER NOT NULL REFERENCES users(id),
    title                TEXT NOT NULL,
    details              TEXT NOT NULL DEFAULT '',
    creator_side         TEXT NOT NULL,
    opponent_side        TEXT NOT NULL,
    amount_cents         INTEGER NOT NULL CHECK (amount_cents > 0),
    settle_by            TEXT,
    status               TEXT NOT NULL DEFAULT 'proposed',
    outcome              TEXT,
    outcome_reported_by  INTEGER REFERENCES users(id),
    requested_at         TEXT,
    paid_at              TEXT,
    paid_marked_by       INTEGER REFERENCES users(id),
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    accepted_at          TEXT,
    settled_at           TEXT
  );
  CREATE INDEX IF NOT EXISTS bets_group ON bets(group_id);
  CREATE INDEX IF NOT EXISTS bets_creator ON bets(creator_id);
  CREATE INDEX IF NOT EXISTS bets_opponent ON bets(opponent_id);

  CREATE TABLE IF NOT EXISTS comments (
    id          INTEGER PRIMARY KEY,
    bet_id      INTEGER NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS comments_bet ON comments(bet_id);
`);

export type UserRow = {
  id: number;
  username: string;
  display_name: string;
  venmo_username: string;
  password_hash: string;
  created_at: string;
};

export type GroupRow = {
  id: number;
  name: string;
  invite_code: string;
  created_by: number;
  created_at: string;
};

export type BetStatus = 'proposed' | 'declined' | 'cancelled' | 'active' | 'reported' | 'disputed' | 'settled';
export type Outcome = 'creator' | 'opponent' | 'push';

export type BetRow = {
  id: number;
  group_id: number;
  creator_id: number;
  opponent_id: number;
  title: string;
  details: string;
  creator_side: string;
  opponent_side: string;
  amount_cents: number;
  settle_by: string | null;
  status: BetStatus;
  outcome: Outcome | null;
  outcome_reported_by: number | null;
  requested_at: string | null;
  paid_at: string | null;
  paid_marked_by: number | null;
  created_at: string;
  accepted_at: string | null;
  settled_at: string | null;
};

export type CommentRow = {
  id: number;
  bet_id: number;
  user_id: number;
  body: string;
  created_at: string;
};
