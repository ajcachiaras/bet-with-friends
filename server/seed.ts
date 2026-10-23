// Creates demo accounts, a group and a few bets in every state so the app has
// something to show locally. Safe to re-run: it skips users that already exist.
//
// Every demo account uses the password below. Log in as any of them.
import { hashPassword } from './auth.js';
import { db } from './db.js';

const DEMO_PASSWORD = 'demo-password';

const demoUsers = [
  { username: 'alex', displayName: 'Alex', venmo: 'alex-demo-venmo' },
  { username: 'sam', displayName: 'Sam', venmo: 'sam-demo-venmo' },
  { username: 'jordan', displayName: 'Jordan', venmo: 'jordan-demo-venmo' },
];

if (db.prepare('SELECT 1 FROM users WHERE username = ?').get('alex')) {
  console.log('Demo data already exists. Delete the data/ folder to start fresh.');
  process.exit(0);
}

const seed = db.transaction(() => {
  const ids: Record<string, number> = {};
  for (const u of demoUsers) {
    const r = db
      .prepare('INSERT INTO users (username, display_name, venmo_username, password_hash) VALUES (?, ?, ?, ?)')
      .run(u.username, u.displayName, u.venmo, hashPassword(DEMO_PASSWORD));
    ids[u.username] = Number(r.lastInsertRowid);
  }

  const groupId = Number(
    db
      .prepare('INSERT INTO bet_groups (name, invite_code, created_by) VALUES (?, ?, ?)')
      .run('Sunday Crew', 'DEMO42', ids.alex).lastInsertRowid,
  );
  for (const id of Object.values(ids)) {
    db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupId, id);
  }

  const bet = db.prepare(
    `INSERT INTO bets (group_id, creator_id, opponent_id, title, details, creator_side, opponent_side, amount_cents,
       settle_by, status, outcome, outcome_reported_by, accepted_at, settled_at)
     VALUES (@group, @creator, @opponent, @title, @details, @mine, @theirs, @cents,
       @settleBy, @status, @outcome, @reportedBy, @acceptedAt, @settledAt)`,
  );
  const base = { group: groupId, details: '', settleBy: null, outcome: null, reportedBy: null, acceptedAt: null, settledAt: null };

  bet.run({
    ...base,
    creator: ids.sam,
    opponent: ids.alex,
    title: 'Who finishes the half marathon faster',
    mine: 'Sam is faster',
    theirs: 'Alex is faster',
    cents: 2500,
    status: 'proposed',
  });
  bet.run({
    ...base,
    creator: ids.alex,
    opponent: ids.jordan,
    title: 'Jordan can’t go a week without coffee',
    details: 'Starts Monday. Decaf counts as coffee.',
    mine: 'Jordan caves',
    theirs: 'Jordan makes it 7 days',
    cents: 1000,
    status: 'active',
    acceptedAt: '2026-10-20 12:00:00',
  });
  bet.run({
    ...base,
    creator: ids.jordan,
    opponent: ids.alex,
    title: 'Thursday night game: over/under 45.5 points',
    mine: 'Over',
    theirs: 'Under',
    cents: 2000,
    status: 'settled',
    outcome: 'opponent',
    reportedBy: ids.jordan,
    acceptedAt: '2026-10-15 18:00:00',
    settledAt: '2026-10-17 01:00:00',
  });
});

seed();
console.log('Seeded demo users alex, sam and jordan (password is in server/seed.ts) in group "Sunday Crew".');
