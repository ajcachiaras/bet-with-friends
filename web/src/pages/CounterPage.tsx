// Countering a bet: the same editor as a new bet, filled in with the current
// terms from your side. Change anything and send it back.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, type Bet, type User } from '../api';
import { useMe } from '../auth';
import { BetTermsFields, useBetTerms, type MyTerms } from '../betTerms';
import { ErrorNote, Loading, useLoad } from '../components';

export function CounterPage() {
  const me = useMe();
  const betId = Number(useParams().id);
  const { data, error } = useLoad(() => api.bet(betId), [betId]);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;
  if (!data.bet.actions.includes('counter')) {
    return (
      <>
        <p className="empty">This bet can&rsquo;t be countered right now.</p>
        <Link to={`/bets/${betId}`} className="btn block">
          Back to the bet
        </Link>
      </>
    );
  }
  // Mounted only once the bet has loaded, so the editor starts from its terms.
  return <CounterForm bet={data.bet} me={me} />;
}

function CounterForm({ bet, me }: { bet: Bet; me: User }) {
  const navigate = useNavigate();
  // On an open bet you'd be the opponent, so everything but the creator is "you".
  const iAmCreator = bet.creator.id === me.id;
  const other = iAmCreator ? bet.opponent! : bet.creator;
  const [original] = useState<MyTerms>(() => ({
    title: bet.title,
    mySide: iAmCreator ? bet.creatorSide : bet.opponentSide,
    theirSide: iAmCreator ? bet.opponentSide : bet.creatorSide,
    myPoints: iAmCreator ? bet.creatorPoints : bet.opponentPoints,
    theirPoints: iAmCreator ? bet.opponentPoints : bet.creatorPoints,
    settleBy: bet.settleBy ?? '',
    details: bet.details,
  }));
  const terms = useBetTerms(original);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    const problem = terms.problem();
    const t = terms.result();
    const unchanged = (Object.keys(original) as (keyof MyTerms)[]).every((k) => original[k] === t[k]);
    setError(problem ?? (unchanged ? 'Change something first, or accept the bet as it is.' : null));
    if (problem || unchanged) return;
    setBusy(true);
    try {
      await api.counterBet(bet.id, {
        title: t.title,
        details: t.details,
        creatorSide: iAmCreator ? t.mySide : t.theirSide,
        opponentSide: iAmCreator ? t.theirSide : t.mySide,
        creatorPoints: iAmCreator ? t.myPoints : t.theirPoints,
        opponentPoints: iAmCreator ? t.theirPoints : t.myPoints,
        settleBy: t.settleBy,
      });
      navigate(`/bets/${bet.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flow">
      <div className="flow-head">
        <button className="flow-back" onClick={() => navigate(`/bets/${bet.id}`, { replace: true })}>
          &lsaquo; Back
        </button>
        <span />
        <span className="flow-group muted small">{bet.groupName}</span>
      </div>

      <div className="flow-step">
        <div>
          <h1 className="flow-q">Your counter</h1>
          <p className="muted counter-intro">
            Change anything, then send it back to {other.displayName}. They can accept, counter again, or decline.
          </p>
        </div>
        <BetTermsFields terms={terms} theirName={other.displayName} isOpen={false} onEdit={() => setError(null)} />

        {/* Pinned to the bottom so Send stays in reach on short screens. */}
        <div className="flow-send">
          <ErrorNote message={error} />
          <button className="btn primary block" disabled={busy} onClick={send}>
            Send counter to {other.displayName}
          </button>
        </div>
      </div>
    </div>
  );
}
