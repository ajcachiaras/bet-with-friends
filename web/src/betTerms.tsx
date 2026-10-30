// The "what's the bet, and how much" editor, shared by making a new bet and
// countering one: the bet text, the sides, the deadline and fine print, and
// the scroll wheels for points and odds. Everything is from the viewer's side
// ("my" side and stake vs "theirs"); callers map that to creator/opponent.
import { useState, type KeyboardEvent } from 'react';
import { EVEN_ODDS_INDEX, ODDS_OPTIONS, STAKE_OPTIONS, theirStake, type Odds } from './bets';
import { formatPoints } from './format';
import { Wheel } from './wheel';

export type MyTerms = {
  title: string;
  mySide: string;
  theirSide: string;
  myPoints: number;
  theirPoints: number;
  settleBy: string;
  details: string;
};

type SideMode = 'yesno' | 'overunder' | 'custom';
const MODES: { mode: SideMode; label: string }[] = [
  { mode: 'yesno', label: 'Yes or no' },
  { mode: 'overunder', label: 'Over or under' },
  { mode: 'custom', label: 'Your own sides' },
];
const PRESET_SIDES = { yesno: ['Yes', 'No'], overunder: ['Over', 'Under'] } as const;

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

// Where the editor starts: blank for a new bet, or the bet's current terms
// for a counter. Stakes or odds the wheels don't list (say 11 points, or 11 to
// 7) are added to them, so untouched terms come back out unchanged.
function startFrom(initial?: MyTerms) {
  if (!initial) {
    return {
      title: '',
      mode: 'yesno' as SideMode,
      swapped: false,
      mySide: '',
      theirSide: '',
      settleBy: '',
      details: '',
      stakeOptions: STAKE_OPTIONS,
      oddsOptions: ODDS_OPTIONS,
      stakeIndex: STAKE_OPTIONS.indexOf(10),
      oddsIndex: EVEN_ODDS_INDEX,
    };
  }

  let mode: SideMode = 'custom';
  let swapped = false;
  for (const preset of ['yesno', 'overunder'] as const) {
    const [first, second] = PRESET_SIDES[preset];
    if (initial.mySide === first && initial.theirSide === second) mode = preset;
    if (initial.mySide === second && initial.theirSide === first) {
      mode = preset;
      swapped = true;
    }
  }

  const stakeOptions = STAKE_OPTIONS.includes(initial.myPoints)
    ? STAKE_OPTIONS
    : [...STAKE_OPTIONS, initial.myPoints].sort((a, b) => a - b);

  const d = gcd(initial.theirPoints, initial.myPoints);
  const ratio: Odds = { label: '', theirs: initial.theirPoints / d, yours: initial.myPoints / d };
  const listed = ODDS_OPTIONS.findIndex((o) => o.theirs * ratio.yours === o.yours * ratio.theirs);
  const oddsOptions =
    listed >= 0
      ? ODDS_OPTIONS
      : [...ODDS_OPTIONS, { ...ratio, label: `${ratio.theirs} to ${ratio.yours}` }].sort(
          (a, b) => a.theirs / a.yours - b.theirs / b.yours,
        );
  const oddsIndex = oddsOptions.findIndex((o) => o.theirs * ratio.yours === o.yours * ratio.theirs);

  return {
    title: initial.title,
    mode,
    swapped,
    mySide: mode === 'custom' ? initial.mySide : '',
    theirSide: mode === 'custom' ? initial.theirSide : '',
    settleBy: initial.settleBy,
    details: initial.details,
    stakeOptions,
    oddsOptions,
    stakeIndex: stakeOptions.indexOf(initial.myPoints),
    oddsIndex,
  };
}

export function useBetTerms(initial?: MyTerms) {
  const [start] = useState(() => startFrom(initial));
  const [title, setTitle] = useState(start.title);
  const [mode, setMode] = useState(start.mode);
  const [swapped, setSwapped] = useState(start.swapped);
  const [mySide, setMySide] = useState(start.mySide);
  const [theirSide, setTheirSide] = useState(start.theirSide);
  const [moreOpen, setMoreOpen] = useState(Boolean(start.settleBy || start.details));
  const [settleBy, setSettleBy] = useState(start.settleBy);
  const [details, setDetails] = useState(start.details);
  const [stakeIndex, setStakeIndex] = useState(start.stakeIndex);
  const [oddsIndex, setOddsIndex] = useState(start.oddsIndex);

  const sides: [string, string] =
    mode === 'custom'
      ? [mySide.trim(), theirSide.trim()]
      : swapped
        ? [PRESET_SIDES[mode][1], PRESET_SIDES[mode][0]]
        : [PRESET_SIDES[mode][0], PRESET_SIDES[mode][1]];
  // Saved and shown with a capital: "the Jets make it" reads as "The Jets make it".
  const betText = title.trim().charAt(0).toUpperCase() + title.trim().slice(1);
  const myPoints = start.stakeOptions[stakeIndex];
  const odds = start.oddsOptions[oddsIndex];
  const theirs = theirStake(myPoints, odds);

  return {
    start,
    title,
    setTitle,
    mode,
    setMode,
    swapped,
    setSwapped,
    mySide,
    setMySide,
    theirSide,
    setTheirSide,
    moreOpen,
    setMoreOpen,
    settleBy,
    setSettleBy,
    details,
    setDetails,
    stakeIndex,
    setStakeIndex,
    oddsIndex,
    setOddsIndex,
    sides,
    betText,
    myPoints,
    odds,
    theirs,

    problem(): string | null {
      if (!title.trim()) return 'Say what the bet is.';
      if (mode === 'custom' && (!sides[0] || !sides[1])) return 'Fill in both sides.';
      return null;
    },

    result(): MyTerms {
      return {
        title: betText,
        mySide: sides[0],
        theirSide: sides[1],
        myPoints,
        theirPoints: theirs.points,
        settleBy,
        details: details.trim(),
      };
    },
  };
}

export type BetTerms = ReturnType<typeof useBetTerms>;

export function BetTermsFields({
  terms: t,
  theirName,
  isOpen,
  autoFocus,
  onEdit,
}: {
  terms: BetTerms;
  // "Sam", or "Whoever takes it" for an open bet.
  theirName: string;
  isOpen: boolean;
  autoFocus?: boolean;
  // Called on any edit, so the page can clear a stale error.
  onEdit: () => void;
}) {
  // Enter closes the keyboard instead of adding a line, so the wheels below
  // come into view.
  function doneOnEnter(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.blur();
    }
  }

  return (
    <>
      <div className="chips">
        {MODES.map((m) => (
          <button
            type="button"
            key={m.mode}
            className={`chip${t.mode === m.mode ? ' selected' : ''}`}
            aria-pressed={t.mode === m.mode}
            onClick={() => {
              t.setMode(m.mode);
              onEdit();
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <label className="big-field">
        <span className="big-field-lead">
          {t.mode === 'yesno'
            ? `I bet ${isOpen ? 'anyone' : theirName} that…`
            : t.mode === 'overunder'
              ? 'Over or under on…'
              : 'What’s it on?'}
        </span>
        <textarea
          value={t.title}
          onChange={(e) => {
            t.setTitle(e.target.value.replace(/\n/g, ' '));
            onEdit();
          }}
          onKeyDown={doneOnEnter}
          rows={2}
          maxLength={120}
          enterKeyHint="done"
          autoFocus={autoFocus}
          placeholder={
            t.mode === 'yesno'
              ? 'the Jets make the playoffs'
              : t.mode === 'overunder'
                ? 'Total points in Chiefs vs Bills, 45.5'
                : 'Chiefs vs Bills on Sunday'
          }
        />
      </label>

      {t.mode === 'custom' ? (
        <div className="custom-sides">
          <label>
            You take
            <input
              value={t.mySide}
              onChange={(e) => {
                t.setMySide(e.target.value);
                onEdit();
              }}
              placeholder="Chiefs win"
              maxLength={120}
            />
          </label>
          <label>
            {isOpen ? 'The other side' : `${theirName} takes`}
            <input
              value={t.theirSide}
              onChange={(e) => {
                t.setTheirSide(e.target.value);
                onEdit();
              }}
              placeholder="Bills win"
              maxLength={120}
            />
          </label>
        </div>
      ) : (
        <div className="side-picks">
          <div className="side-pick mine">
            <span className="muted small">You</span>
            <strong>{t.sides[0]}</strong>
          </div>
          <button type="button" className="swap" aria-label="Swap sides" onClick={() => t.setSwapped(!t.swapped)}>
            &#8644;
          </button>
          <div className="side-pick">
            <span className="muted small">{theirName}</span>
            <strong>{t.sides[1]}</strong>
          </div>
        </div>
      )}

      {t.moreOpen ? (
        <div className="more-options">
          <label>
            <span>
              Settle by <span className="muted">(optional)</span>
            </span>
            <input type="date" value={t.settleBy} onChange={(e) => t.setSettleBy(e.target.value)} />
          </label>
          <label>
            <span>
              Fine print <span className="muted">(optional)</span>
            </span>
            <textarea
              value={t.details}
              onChange={(e) => t.setDetails(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Overtime counts."
            />
          </label>
        </div>
      ) : (
        <button type="button" className="link-btn" onClick={() => t.setMoreOpen(true)}>
          + Deadline or fine print
        </button>
      )}

      <div className="wheels">
        <Wheel
          label="You put up"
          options={t.start.stakeOptions}
          value={t.stakeIndex}
          onChange={t.setStakeIndex}
          render={(n) => n.toLocaleString()}
        />
        <Wheel label="Odds" options={t.start.oddsOptions} value={t.oddsIndex} onChange={t.setOddsIndex} render={(o) => o.label} />
      </div>

      <div className="card slip">
        <div className="slip-line">
          You risk <strong>{formatPoints(t.myPoints)}</strong> to win <strong>{formatPoints(t.theirs.points)}</strong>.
        </div>
        <div className="muted small">
          {t.odds.theirs === t.odds.yours
            ? 'Even: you both put up the same.'
            : t.odds.theirs > t.odds.yours
              ? 'Your side is the long shot, so they put up more.'
              : 'Your side is the favorite, so you put up more.'}
          {!t.theirs.exact && ' Rounded to whole points.'}
        </div>
      </div>
    </>
  );
}
