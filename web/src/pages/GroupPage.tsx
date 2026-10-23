import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, type GroupDetail } from '../api';
import { useMe } from '../auth';
import { Avatar, BetCard, ErrorNote, Loading, useLoad } from '../components';
import { formatSignedMoney } from '../format';

type Tab = 'bets' | 'leaderboard' | 'members';

export function GroupPage() {
  const me = useMe();
  const groupId = Number(useParams().id);
  const { data, error } = useLoad(() => api.group(groupId), [groupId]);
  const [tab, setTab] = useState<Tab>('bets');

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  const canBet = data.members.length > 1;

  return (
    <>
      <Link to="/" className="back">
        &lsaquo; Home
      </Link>
      <h1>{data.group.name}</h1>
      <p className="muted">
        {data.members.length} {data.members.length === 1 ? 'member' : 'members'}
      </p>

      <InviteCard code={data.group.inviteCode} groupName={data.group.name} />

      {canBet ? (
        <Link to={`/groups/${groupId}/new`} className="btn primary block">
          + New bet
        </Link>
      ) : (
        <p className="empty">Invite at least one friend and you can start betting.</p>
      )}

      <div className="segmented" role="tablist">
        {(['bets', 'leaderboard', 'members'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'bets' && <BetsTab data={data} meId={me.id} />}
      {tab === 'leaderboard' && <LeaderboardTab data={data} meId={me.id} />}
      {tab === 'members' && <MembersTab data={data} />}
    </>
  );
}

function InviteCard({ code, groupName }: { code: string; groupName: string }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/join/${code}`;

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${groupName} on Bet with Friends`, url: link });
        return;
      } catch {
        // Share sheet dismissed or unavailable. Fall back to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this invite link:', link);
    }
  }

  return (
    <div className="card invite">
      <div>
        <div className="muted small">Invite code</div>
        <div className="invite-code">{code}</div>
      </div>
      <button className="btn" onClick={share}>
        {copied ? 'Link copied' : 'Share invite'}
      </button>
    </div>
  );
}

function BetsTab({ data, meId }: { data: GroupDetail; meId: number }) {
  if (data.bets.length === 0) return <p className="empty">No bets yet. Someone has to go first.</p>;
  const open = data.bets.filter((b) => ['proposed', 'active', 'reported', 'disputed'].includes(b.status) || b.todo);
  const closed = data.bets.filter((b) => !open.includes(b));
  return (
    <div className="stack">
      {open.map((b) => (
        <BetCard key={b.id} bet={b} meId={meId} />
      ))}
      {closed.length > 0 && open.length > 0 && <h3 className="divider">History</h3>}
      {closed.map((b) => (
        <BetCard key={b.id} bet={b} meId={meId} />
      ))}
    </div>
  );
}

function LeaderboardTab({ data, meId }: { data: GroupDetail; meId: number }) {
  return (
    <div className="card list">
      {data.leaderboard.map((row, i) => (
        <div key={row.user.id} className={`list-row${row.user.id === meId ? ' me' : ''}`}>
          <span className="rank">{i + 1}</span>
          <Avatar user={row.user} size={32} />
          <div className="grow">
            <div>{row.user.displayName}</div>
            <div className="muted small">
              {row.wins}W &ndash; {row.losses}L{row.pushes > 0 && ` – ${row.pushes}P`}
            </div>
          </div>
          <span className={`net ${row.net > 0 ? 'won' : row.net < 0 ? 'lost' : ''}`}>{formatSignedMoney(row.net)}</span>
        </div>
      ))}
    </div>
  );
}

function MembersTab({ data }: { data: GroupDetail }) {
  return (
    <div className="card list">
      {data.members.map((u) => (
        <div key={u.id} className="list-row">
          <Avatar user={u} size={32} />
          <div className="grow">
            <div>{u.displayName}</div>
            <div className="muted small">@{u.username}</div>
          </div>
          <span className="venmo-handle">Venmo @{u.venmoUsername}</span>
        </div>
      ))}
    </div>
  );
}
