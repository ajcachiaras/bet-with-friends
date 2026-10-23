export type User = {
  id: number;
  username: string;
  displayName: string;
  venmoUsername: string;
};

export type BetStatus = 'proposed' | 'declined' | 'cancelled' | 'active' | 'reported' | 'disputed' | 'settled';
export type BetAction = 'accept' | 'decline' | 'cancel' | 'report' | 'confirm' | 'dispute' | 'requested' | 'paid';

export type Bet = {
  id: number;
  groupId: number;
  groupName?: string;
  title: string;
  details: string;
  creatorSide: string;
  opponentSide: string;
  amountCents: number;
  settleBy: string | null;
  status: BetStatus;
  outcome: 'creator' | 'opponent' | 'push' | null;
  outcomeReportedBy: number | null;
  requestedAt: string | null;
  paidAt: string | null;
  paidMarkedBy: number | null;
  createdAt: string;
  acceptedAt: string | null;
  settledAt: string | null;
  creator: User;
  opponent: User;
  winnerId: number | null;
  loserId: number | null;
  actions: BetAction[];
  todo: string | null;
};

export type Comment = { id: number; body: string; createdAt: string; user: User };

export type GroupSummary = { id: number; name: string; inviteCode: string; memberCount: number; liveBets: number };

export type LeaderboardRow = { user: User; net: number; wins: number; losses: number; pushes: number };

export type GroupDetail = {
  group: { id: number; name: string; inviteCode: string; createdBy: number };
  members: User[];
  leaderboard: LeaderboardRow[];
  bets: Bet[];
};

export type BetDetail = { bet: Bet; comments: Comment[] };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  me: () => request<{ user: User | null }>('GET', '/me'),
  updateMe: (body: { displayName?: string; venmoUsername?: string }) => request<{ user: User }>('PATCH', '/me', body),
  signup: (body: { username: string; displayName: string; venmoUsername: string; password: string }) =>
    request<{ user: User }>('POST', '/auth/signup', body),
  login: (body: { username: string; password: string }) => request<{ user: User }>('POST', '/auth/login', body),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),

  groups: () => request<{ groups: GroupSummary[] }>('GET', '/groups'),
  createGroup: (name: string) => request<{ groupId: number }>('POST', '/groups', { name }),
  joinGroup: (code: string) => request<{ groupId: number }>('POST', '/groups/join', { code }),
  group: (id: number) => request<GroupDetail>('GET', `/groups/${id}`),

  myBets: () => request<{ bets: Bet[] }>('GET', '/me/bets'),
  createBet: (
    groupId: number,
    body: {
      opponentId: number;
      title: string;
      details: string;
      creatorSide: string;
      opponentSide: string;
      amount: string;
      settleBy: string;
    },
  ) => request<{ betId: number }>('POST', `/groups/${groupId}/bets`, body),
  bet: (id: number) => request<BetDetail>('GET', `/bets/${id}`),
  betAction: (id: number, action: BetAction, body?: { winner: 'me' | 'them' | 'push' }) =>
    request<BetDetail>('POST', `/bets/${id}/actions/${action}`, body ?? {}),
  comment: (id: number, body: string) => request<BetDetail>('POST', `/bets/${id}/comments`, { body }),
};
