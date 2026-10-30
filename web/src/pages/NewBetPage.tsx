// Making a bet, one question per screen: who, what, how much. Reached from
// the + button on Home (/new), a group page (/groups/:id/new), or a "Bet"
// button next to a friend (/groups/:id/new?vs=<their id>, which skips to
// "what").
import { useEffect, useState, type KeyboardEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { api, type User } from '../api';
import { useMe } from '../auth';
import { EVEN_ODDS_INDEX, ODDS_OPTIONS, STAKE_OPTIONS, theirStake } from '../bets';
import { Avatar, ErrorNote, Loading, OpenSeat, useLoad } from '../components';
import { formatPoints } from '../format';
import { Wheel } from '../wheel';

// Picking this instead of a member posts the bet to the group board.
const ANYONE = 'anyone';
const LAST_GROUP_KEY = 'bwf-last-group';

type SideMode = 'yesno' | 'overunder' | 'custom';
const MODES: { mode: SideMode; label: string }[] = [
  { mode: 'yesno', label: 'Yes or no' },
  { mode: 'overunder', label: 'Over or under' },
  { mode: 'custom', label: 'Your own sides' },
];
const PRESET_SIDES = { yesno: ['Yes', 'No'], overunder: ['Over', 'Under'] } as const;

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

  const [groupId, setGroupId] = useState<number | null>(routeGroupId);
  const [members, setMembers] = useState<User[] | null>(null);
  const [opponent, setOpponent] = useState<string | null>(params.get('vs'));
  const [step, setStep] = useState(params.get('vs') ? 2 : 1);

  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<SideMode>('yesno');
  const [swapped, setSwapped] = useState(false);
  const [mySide, setMySide] = useState('');
  const [theirSide, setTheirSide] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [settleBy, setSettleBy] = useState('');
  const [details, setDetails] = useState('');
  const [stakeIndex, setStakeIndex] = useState(STAKE_OPTIONS.indexOf(10));
  const [oddsIndex, setOddsIndex] = useState(EVEN_ODDS_INDEX);

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
  const theirName = isOpen ? 'Whoever takes it' : (opponentUser?.displayName ?? 'They');
  const sides: [string, string] =
    mode === 'custom'
      ? [mySide.trim(), theirSide.trim()]
      : swapped
        ? [PRESET_SIDES[mode][1], PRESET_SIDES[mode][0]]
        : [PRESET_SIDES[mode][0], PRESET_SIDES[mode][1]];
  // Saved and shown with a capital: "the Jets make it" reads as "The Jets make it".
  const betText = title.trim().charAt(0).toUpperCase() + title.trim().slice(1);
  const mine = STAKE_OPTIONS[stakeIndex];
  const odds = ODDS_OPTIONS[oddsIndex];
  const theirs = theirStake(mine, odds);

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

  function checkWhat(): string | null {
    if (!title.trim()) return 'Say what the bet is.';
    if (mode === 'custom' && (!sides[0] || !sides[1])) return 'Fill in both sides.';
    return null;
  }

  function next() {
    const problem = checkWhat();
    setError(problem);
    if (!problem) setStep(3);
  }

  function nextOnEnter(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      next();
    }
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const { betId } = await api.createBet(group!.id, {
        opponentId: isOpen ? null : opponent,
        title: betText,
        creatorSide: sides[0],
        opponentSide: sides[1],
        creatorPoints: String(mine),
        opponentPoints: String(theirs.points),
        settleBy,
        details,
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
        <div className="flow-progress" aria-label={`Step ${step} of 3`}>
          {[1, 2, 3].map((s) => (
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
          <div className="chips">
            {MODES.map((m) => (
              <button
                type="button"
                key={m.mode}
                className={`chip${mode === m.mode ? ' selected' : ''}`}
                aria-pressed={mode === m.mode}
                onClick={() => {
                  setMode(m.mode);
                  setError(null);
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          <label className="big-field">
            <span className="big-field-lead">
              {mode === 'yesno'
                ? `I bet ${isOpen ? 'anyone' : opponentUser?.displayName} that…`
                : mode === 'overunder'
                  ? 'Over or under on…'
                  : 'What’s it on?'}
            </span>
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
              onKeyDown={nextOnEnter}
              rows={2}
              maxLength={120}
              enterKeyHint="next"
              autoFocus
              placeholder={
                mode === 'yesno'
                  ? 'the Jets make the playoffs'
                  : mode === 'overunder'
                    ? 'Total points in Chiefs vs Bills, 45.5'
                    : 'Chiefs vs Bills on Sunday'
              }
            />
          </label>

          {mode === 'custom' ? (
            <div className="custom-sides">
              <label>
                You take
                <input value={mySide} onChange={(e) => setMySide(e.target.value)} placeholder="Chiefs win" maxLength={120} />
              </label>
              <label>
                {isOpen ? 'The other side' : `${theirName} takes`}
                <input
                  value={theirSide}
                  onChange={(e) => setTheirSide(e.target.value)}
                  placeholder="Bills win"
                  maxLength={120}
                />
              </label>
            </div>
          ) : (
            <div className="side-picks">
              <div className="side-pick mine">
                <span className="muted small">You</span>
                <strong>{sides[0]}</strong>
              </div>
              <button type="button" className="swap" aria-label="Swap sides" onClick={() => setSwapped(!swapped)}>
                &#8644;
              </button>
              <div className="side-pick">
                <span className="muted small">{theirName}</span>
                <strong>{sides[1]}</strong>
              </div>
            </div>
          )}

          {moreOpen ? (
            <div className="more-options">
              <label>
                <span>
                  Settle by <span className="muted">(optional)</span>
                </span>
                <input type="date" value={settleBy} onChange={(e) => setSettleBy(e.target.value)} />
              </label>
              <label>
                <span>
                  Fine print <span className="muted">(optional)</span>
                </span>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  rows={2}
                  maxLength={1000}
                  placeholder="Overtime counts."
                />
              </label>
            </div>
          ) : (
            <button type="button" className="link-btn" onClick={() => setMoreOpen(true)}>
              + Deadline or fine print
            </button>
          )}

          <ErrorNote message={error} />
          <button className="btn primary block flow-next" onClick={next}>
            Next
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="flow-step" key="stake">
          <h1 className="flow-q">How much?</h1>
          <div className="wheels">
            <Wheel
              label="You put up"
              options={STAKE_OPTIONS}
              value={stakeIndex}
              onChange={setStakeIndex}
              render={(n) => n.toLocaleString()}
            />
            <Wheel label="Odds" options={ODDS_OPTIONS} value={oddsIndex} onChange={setOddsIndex} render={(o) => o.label} />
          </div>

          <div className="card slip">
            <div className="slip-title">{betText}</div>
            <div className="muted small">
              You: {sides[0]} &middot; {theirName}: {sides[1]}
            </div>
            <div className="slip-line">
              You risk <strong>{formatPoints(mine)}</strong> to win <strong>{formatPoints(theirs.points)}</strong>.
            </div>
            <div className="muted small">
              {odds.theirs === odds.yours
                ? 'Even: you both put up the same.'
                : odds.theirs > odds.yours
                  ? 'Your side is the long shot, so they put up more.'
                  : 'Your side is the favorite, so you put up more.'}
              {!theirs.exact && ' Rounded to whole points.'}
            </div>
          </div>

          <ErrorNote message={error} />
          <button className="btn primary block flow-next" disabled={busy} onClick={send}>
            {isOpen ? 'Put it on the board' : `Send to ${opponentUser?.displayName}`}
          </button>
        </div>
      )}
    </div>
  );
}
