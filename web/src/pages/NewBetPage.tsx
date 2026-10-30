// Making a bet in two screens: who, then the bet itself (what and how much).
// Reached from the + button on Home (/new), a group page (/groups/:id/new),
// or a "Bet" button next to a friend (/groups/:id/new?vs=<their id>, which
// skips to the second screen).
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { api, type User } from '../api';
import { useMe } from '../auth';
import { BetTermsFields, useBetTerms } from '../betTerms';
import { Avatar, ErrorNote, Loading, OpenSeat, useLoad } from '../components';

// Picking this instead of a member posts the bet to the group board.
const ANYONE = 'anyone';
const LAST_GROUP_KEY = 'bwf-last-group';

function lastGroup(): number | null {
  try {
    return Number(localStorage.getItem(LAST_GROUP_KEY)) || null;
  } catch {
    return null;
  }
}

function rememberGroup(id: number) {
  try {
    localStorage.setItem(LAST_GROUP_KEY, String(id));
  } catch {
    // Private mode: the flow just starts on the first group next time.
  }
}

export function NewBetPage() {
  const me = useMe();
  const navigate = useNavigate();
  const routeGroupId = Number(useParams().id) || null;
  const [params] = useSearchParams();
  const groups = useLoad(() => api.groups(), []);
  const terms = useBetTerms();

  const [groupId, setGroupId] = useState<number | null>(routeGroupId);
  const [members, setMembers] = useState<User[] | null>(null);
  const [opponent, setOpponent] = useState<string | null>(params.get('vs'));
  const [step, setStep] = useState(params.get('vs') ? 2 : 1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Without a group in the URL, start on the one used last (or the first).
  useEffect(() => {
    if (groupId !== null || !groups.data?.groups.length) return;
    const ids = groups.data.groups.map((g) => g.id);
    const last = lastGroup();
    setGroupId(last !== null && ids.includes(last) ? last : ids[0]);
  }, [groups.data, groupId]);

  useEffect(() => {
    if (groupId === null) return;
    let live = true;
    setMembers(null);
    api
      .groupMembers(groupId)
      .then((r) => {
        if (!live) return;
        setMembers(r.members);
        // A "Bet Sam" link for someone who isn't in this group starts over at "who".
        setOpponent((o) => (o === ANYONE || r.members.some((m) => m.id === o && m.id !== me.id) ? o : null));
      })
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [groupId, me.id]);

  useEffect(() => {
    if (step > 1 && members && opponent === null) setStep(1);
  }, [step, members, opponent]);

  if (groups.error) return <ErrorNote message={groups.error} />;
  if (!groups.data) return <Loading />;
  if (groups.data.groups.length === 0) {
    return (
      <>
        <p className="empty">Bets happen inside groups. Start one for your friends, or join with an invite code.</p>
        <button className="btn block" onClick={() => navigate('/')}>
          Go to your groups
        </button>
      </>
    );
  }
  const group = groups.data.groups.find((g) => g.id === groupId);
  if (groupId !== null && !group) return <ErrorNote message="Group not found." />;
  if (!group || !members) return <Loading />;

  const others = members.filter((u) => u.id !== me.id);
  const isOpen = opponent === ANYONE;
  const opponentUser = others.find((u) => u.id === opponent);

  function leave() {
    // React Router counts entries in history.state; 0 means this is the first page.
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate('/');
  }

  function back() {
    setError(null);
    if (step > 1) setStep(step - 1);
    else leave();
  }

  function pick(id: string) {
    setOpponent(id);
    setError(null);
    setStep(2);
  }

  function switchGroup(id: number) {
    if (id === groupId) return;
    setGroupId(id);
    setOpponent(null);
  }

  async function send() {
    const problem = terms.problem();
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      const t = terms.result();
      const { betId } = await api.createBet(group!.id, {
        opponentId: isOpen ? null : opponent,
        title: t.title,
        creatorSide: t.mySide,
        opponentSide: t.theirSide,
        creatorPoints: String(t.myPoints),
        opponentPoints: String(t.theirPoints),
        settleBy: t.settleBy,
        details: t.details,
      });
      rememberGroup(group!.id);
      navigate(`/bets/${betId}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flow">
      <div className="flow-head">
        <button className="flow-back" onClick={back}>
          &lsaquo; {step === 1 ? 'Cancel' : 'Back'}
        </button>
        <div className="flow-progress" aria-label={`Step ${step} of 2`}>
          {[1, 2].map((s) => (
            <span key={s} className={s <= step ? 'done' : ''} />
          ))}
        </div>
        <span className="flow-group muted small">{group.name}</span>
      </div>

      {step === 1 && (
        <div className="flow-step" key="who">
          <h1 className="flow-q">Who are you betting?</h1>
          {groups.data.groups.length > 1 && (
            <div className="chips flow-groups">
              {groups.data.groups.map((g) => (
                <button
                  type="button"
                  key={g.id}
                  className={`chip${g.id === groupId ? ' selected' : ''}`}
                  aria-pressed={g.id === groupId}
                  onClick={() => switchGroup(g.id)}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
          {others.length === 0 ? (
            <>
              <p className="empty">Nobody else is in {group.name} yet. Invite a friend first.</p>
              <button className="btn block" onClick={() => navigate(`/groups/${group.id}`)}>
                Invite friends
              </button>
            </>
          ) : (
            <div className="who-grid">
              {others.map((u) => (
                <button
                  type="button"
                  key={u.id}
                  className={`who-tile${u.id === opponent ? ' selected' : ''}`}
                  onClick={() => pick(u.id)}
                >
                  <Avatar user={u} size={52} />
                  <span className="who-name">{u.displayName}</span>
                </button>
              ))}
              <button
                type="button"
                className={`who-tile wide${isOpen ? ' selected' : ''}`}
                onClick={() => pick(ANYONE)}
              >
                <OpenSeat size={52} />
                <span>
                  <span className="who-name">Anyone in the group</span>
                  <span className="muted small">First to take it is your opponent</span>
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="flow-step" key="what">
          <h1 className="flow-q">What&rsquo;s the bet?</h1>
          <BetTermsFields
            terms={terms}
            theirName={isOpen ? 'Whoever takes it' : (opponentUser?.displayName ?? 'They')}
            isOpen={isOpen}
            autoFocus
            onEdit={() => setError(null)}
          />

          {/* Pinned to the bottom so Send stays in reach on short screens. */}
          <div className="flow-send">
            <ErrorNote message={error} />
            <button className="btn primary block" disabled={busy} onClick={send}>
              {isOpen ? 'Put it on the board' : `Send to ${opponentUser?.displayName}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
