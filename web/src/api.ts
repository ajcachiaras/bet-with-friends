// Everything the app reads and writes, on top of Supabase. Reads go straight
// to the tables (row level security limits them to your own groups); changes
// to groups and bets go through the database functions in supabase/schema.sql.
import type { User as AuthUser } from '@supabase/supabase-js';
import { allowedActions, loserOf, todoFor, winnerOf } from './bets';
import { supabase } from './supabase';

export type User = {
  id: string;
  displayName: string;
};

export type Me = User & { email: string };

export type BetStatus = 'proposed' | 'declined' | 'cancelled' | 'active' | 'reported' | 'disputed' | 'settled';
export type Outcome = 'creator' | 'opponent' | 'push';
export type BetAction = 'accept' | 'decline' | 'cancel' | 'report' | 'confirm' | 'dispute';

export type Bet = {
  id: number;
  groupId: number;
  groupName?: string;
  title: string;
  details: string;
  creatorSide: string;
  opponentSide: string;
  points: number;
  settleBy: string | null;
  status: BetStatus;
  outcome: Outcome | null;
  outcomeReportedBy: string | null;
  createdAt: string;
  acceptedAt: string | null;
  settledAt: string | null;
  creator: User;
  opponent: User;
  winnerId: string | null;
  loserId: string | null;
  actions: BetAction[];
  todo: string | null;
};

export type Comment = { id: number; body: string; createdAt: string; user: User };

export type GroupSummary = { id: number; name: string; inviteCode: string; memberCount: number; liveBets: number };

export type LeaderboardRow = { user: User; net: number; wins: number; losses: number; pushes: number };

export type GroupDetail = {
  group: { id: number; name: string; inviteCode: string; createdBy: string };
  members: User[];
  leaderboard: LeaderboardRow[];
  bets: Bet[];
};

export type BetDetail = { bet: Bet; comments: Comment[] };

export class ApiError extends Error {}

// ---------- Row shapes as Supabase returns them ----------

type ProfileRow = { id: string; display_name: string };

type BetRow = {
  id: number;
  group_id: number;
  creator_id: string;
  opponent_id: string;
  title: string;
  details: string;
  creator_side: string;
  opponent_side: string;
  points: number;
  settle_by: string | null;
  status: BetStatus;
  outcome: Outcome | null;
  outcome_reported_by: string | null;
  created_at: string;
  accepted_at: string | null;
  settled_at: string | null;
  group: { name: string } | null;
  creator: ProfileRow | null;
  opponent: ProfileRow | null;
};

// bets has several foreign keys to profiles, so each embed names its key.
const BET_SELECT = `*,
  group:bet_groups(name),
  creator:profiles!bets_creator_id_fkey(id, display_name),
  opponent:profiles!bets_opponent_id_fkey(id, display_name)`;

const LIVE_STATUSES: BetStatus[] = ['active', 'reported', 'disputed'];

// Without generated database types, supabase-js guesses result shapes (it
// types every embed as an array), so callers state the shape they expect.
type Query = PromiseLike<{ data: unknown; error: { message: string } | null }>;

async function run<T>(query: Query): Promise<T> {
  const { data, error } = await query;
  if (error) throw new ApiError(error.message);
  return data as T;
}

async function myId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new ApiError('Please log in.');
  return data.session.user.id;
}

function toUser(p: ProfileRow | null, fallbackId: string): User {
  return p ? { id: p.id, displayName: p.display_name } : { id: fallbackId, displayName: 'Someone' };
}

function toBet(r: BetRow, meId: string): Bet {
  const facts = {
    status: r.status,
    outcome: r.outcome,
    outcomeReportedBy: r.outcome_reported_by,
    settleBy: r.settle_by,
    creatorId: r.creator_id,
    opponentId: r.opponent_id,
  };
  return {
    id: r.id,
    groupId: r.group_id,
    groupName: r.group?.name,
    title: r.title,
    details: r.details,
    creatorSide: r.creator_side,
    opponentSide: r.opponent_side,
    points: r.points,
    settleBy: r.settle_by,
    status: r.status,
    outcome: r.outcome,
    outcomeReportedBy: r.outcome_reported_by,
    createdAt: r.created_at,
    acceptedAt: r.accepted_at,
    settledAt: r.settled_at,
    creator: toUser(r.creator, r.creator_id),
    opponent: toUser(r.opponent, r.opponent_id),
    winnerId: winnerOf(facts),
    loserId: loserOf(facts),
    actions: allowedActions(facts, meId),
    todo: todoFor(facts, meId),
  };
}

async function loadMe(authUser: AuthUser): Promise<Me> {
  const profile = await run<ProfileRow | null>(
    supabase.from('profiles').select('id, display_name').eq('id', authUser.id).maybeSingle(),
  );
  if (!profile) throw new ApiError('Your profile is missing. Try signing up again.');
  return { ...toUser(profile, authUser.id), email: authUser.email ?? '' };
}

// Net points and record per member, across every settled bet in the group.
function leaderboard(members: User[], bets: Bet[]): LeaderboardRow[] {
  const stats = new Map(members.map((u) => [u.id, { net: 0, wins: 0, losses: 0, pushes: 0 }]));
  for (const b of bets) {
    if (b.status !== 'settled') continue;
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
      ws.net += b.points;
      ws.wins++;
    }
    if (ls) {
      ls.net -= b.points;
      ls.losses++;
    }
  }
  return members
    .map((u) => ({ user: u, ...stats.get(u.id)! }))
    .sort((a, b) => b.net - a.net || b.wins - a.wins);
}

export const api = {
  // ---------- Accounts ----------

  async me(): Promise<{ user: Me | null }> {
    const { data } = await supabase.auth.getSession();
    return { user: data.session ? await loadMe(data.session.user) : null };
  },

  async signup(body: { email: string; displayName: string; password: string }): Promise<{ user: Me }> {
    const { data, error } = await supabase.auth.signUp({
      email: body.email.trim(),
      password: body.password,
      options: { data: { display_name: body.displayName.trim() } },
    });
    if (error) throw new ApiError(error.message);
    // No session means the project still requires email confirmation.
    if (!data.session) throw new ApiError('Check your email for a confirmation link, then log in.');
    return { user: await loadMe(data.session.user) };
  },

  async login(body: { email: string; password: string }): Promise<{ user: Me }> {
    const { data, error } = await supabase.auth.signInWithPassword({ email: body.email.trim(), password: body.password });
    if (error) throw new ApiError(error.message);
    return { user: await loadMe(data.user) };
  },

  async logout(): Promise<void> {
    await supabase.auth.signOut();
  },

  async updateMe(body: { displayName: string }): Promise<{ user: Me }> {
    const id = await myId();
    await run(supabase.from('profiles').update({ display_name: body.displayName.trim() }).eq('id', id));
    const { data } = await supabase.auth.getSession();
    return { user: await loadMe(data.session!.user) };
  },

  // ---------- Groups ----------

  async groups(): Promise<{ groups: GroupSummary[] }> {
    const rows = await run<{ id: number; name: string; invite_code: string; group_members: unknown[]; bets: { status: BetStatus }[] }[]>(
      supabase
        .from('bet_groups')
        .select('id, name, invite_code, group_members(user_id), bets(status)')
        .order('created_at', { ascending: false }),
    );
    return {
      groups: rows.map((g) => ({
        id: g.id,
        name: g.name,
        inviteCode: g.invite_code,
        memberCount: g.group_members.length,
        liveBets: g.bets.filter((b) => LIVE_STATUSES.includes(b.status)).length,
      })),
    };
  },

  async createGroup(name: string): Promise<{ groupId: number }> {
    return { groupId: await run<number>(supabase.rpc('create_group', { group_name: name })) };
  },

  async joinGroup(code: string): Promise<{ groupId: number }> {
    return { groupId: await run<number>(supabase.rpc('join_group', { code })) };
  },

  async group(id: number): Promise<GroupDetail> {
    const meId = await myId();
    const [group, memberRows, betRows] = await Promise.all([
      run<{ id: number; name: string; invite_code: string; created_by: string } | null>(
        supabase.from('bet_groups').select('id, name, invite_code, created_by').eq('id', id).maybeSingle(),
      ),
      run<{ user_id: string; profile: ProfileRow | null }[]>(
        supabase
          .from('group_members')
          .select('user_id, profile:profiles(id, display_name)')
          .eq('group_id', id)
          .order('joined_at'),
      ),
      run<BetRow[]>(
        supabase.from('bets').select(BET_SELECT).eq('group_id', id).order('created_at', { ascending: false }).limit(200),
      ),
    ]);
    if (!group) throw new ApiError('Group not found.');

    const members = memberRows.map((m) => toUser(m.profile, m.user_id));
    const bets = betRows.map((b) => toBet(b, meId));
    return {
      group: { id: group.id, name: group.name, inviteCode: group.invite_code, createdBy: group.created_by },
      members,
      leaderboard: leaderboard(members, bets),
      bets,
    };
  },

  // ---------- Bets ----------

  // Bets across all of my groups, newest first.
  async myBets(): Promise<{ bets: Bet[] }> {
    const meId = await myId();
    const rows = await run<BetRow[]>(
      supabase
        .from('bets')
        .select(BET_SELECT)
        .or(`creator_id.eq.${meId},opponent_id.eq.${meId}`)
        .order('created_at', { ascending: false })
        .limit(200),
    );
    return { bets: rows.map((b) => toBet(b, meId)) };
  },

  async createBet(
    groupId: number,
    body: {
      opponentId: string;
      title: string;
      details: string;
      creatorSide: string;
      opponentSide: string;
      points: string;
      settleBy: string;
    },
  ): Promise<{ betId: number }> {
    const points = Number(body.points);
    if (!Number.isInteger(points)) throw new ApiError('Points must be a whole number.');
    const betId = await run<number>(
      supabase.rpc('create_bet', {
        p_group_id: groupId,
        p_opponent_id: body.opponentId,
        p_title: body.title,
        p_creator_side: body.creatorSide,
        p_opponent_side: body.opponentSide,
        p_points: points,
        p_details: body.details,
        p_settle_by: body.settleBy || null,
      }),
    );
    return { betId };
  },

  async bet(id: number): Promise<BetDetail> {
    const meId = await myId();
    const [bet, comments] = await Promise.all([
      run<BetRow | null>(supabase.from('bets').select(BET_SELECT).eq('id', id).maybeSingle()),
      run<{ id: number; body: string; created_at: string; user_id: string; user: ProfileRow | null }[]>(
        supabase
          .from('comments')
          .select('id, body, created_at, user_id, user:profiles(id, display_name)')
          .eq('bet_id', id)
          .order('created_at')
          .order('id'),
      ),
    ]);
    if (!bet) throw new ApiError('Bet not found.');
    return {
      bet: toBet(bet, meId),
      comments: comments.map((c) => ({ id: c.id, body: c.body, createdAt: c.created_at, user: toUser(c.user, c.user_id) })),
    };
  },

  async betAction(id: number, action: BetAction, body?: { winner: 'me' | 'them' | 'push' }): Promise<BetDetail> {
    await run(supabase.rpc('bet_action', { p_bet_id: id, p_action: action, p_winner: body?.winner ?? null }));
    return api.bet(id);
  },

  async comment(id: number, body: string): Promise<BetDetail> {
    await run(supabase.from('comments').insert({ bet_id: id, body: body.trim() }));
    return api.bet(id);
  },
};
