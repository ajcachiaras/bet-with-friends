import { useEffect, useState } from 'react';
import { ErrorNote } from './components';
import {
  canPromptInstall,
  isIos,
  onInstallPromptChange,
  promptInstall,
  pushStatus,
  turnOffPush,
  turnOnPush,
  type PushStatus,
} from './push';

const WHAT_YOU_HEAR =
  'You’ll hear when someone bets you, takes your bet, reports a result, or comments on one of your bets.';

function usePushStatus() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  useEffect(() => {
    pushStatus()
      .then(setStatus)
      .catch(() => setStatus('unsupported'));
  }, []);
  return [status, setStatus] as const;
}

function useInstallPrompt(): boolean {
  const [available, setAvailable] = useState(canPromptInstall());
  useEffect(() => onInstallPromptChange(() => setAvailable(canPromptInstall())), []);
  return available;
}

function AddToHomeScreenSteps() {
  return isIos() ? (
    <p>
      On iPhone, notifications work once the app is on your Home Screen. In Safari, tap <strong>Share</strong>, then{' '}
      <strong>Add to Home Screen</strong>, and open Bets from there.
    </p>
  ) : (
    <p>This browser can&rsquo;t show notifications. Try Chrome on Android, or Safari on an iPhone.</p>
  );
}

// The Profile page's notification settings for this device.
export function NotificationsCard() {
  const [status, setStatus] = usePushStatus();
  const installable = useInstallPrompt();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStatus(await pushStatus().catch(() => 'unsupported' as const));
      setBusy(false);
    }
  }

  return (
    <div className="card panel">
      <h2>Notifications</h2>
      {status === null && <p className="muted">Checking this device&hellip;</p>}
      {status === 'on' && (
        <>
          <p>On for this device. {WHAT_YOU_HEAR}</p>
          <button className="btn subtle" disabled={busy} onClick={() => change(turnOffPush)}>
            Turn off on this device
          </button>
        </>
      )}
      {status === 'off' && (
        <>
          <p>{WHAT_YOU_HEAR}</p>
          <button className="btn primary" disabled={busy} onClick={() => change(turnOnPush)}>
            Turn on notifications
          </button>
        </>
      )}
      {status === 'blocked' && (
        <p>Notifications are blocked for this app. Allow them in your browser or phone settings, then come back here.</p>
      )}
      {(status === 'install-first' || status === 'unsupported') && <AddToHomeScreenSteps />}
      {installable && (
        <button className="btn" onClick={() => promptInstall()}>
          Install the app
        </button>
      )}
      <ErrorNote message={error} />
    </div>
  );
}

const DISMISSED_KEY = 'bwf-push-banner-dismissed';

function bannerDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

// A one-time nudge on the home screen until notifications are on (or waved off).
export function PushBanner() {
  const [status, setStatus] = usePushStatus();
  const [dismissed, setDismissed] = useState(bannerDismissed);
  const [error, setError] = useState<string | null>(null);

  if (dismissed || (status !== 'off' && status !== 'install-first')) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Private mode: it just comes back next visit.
    }
    setDismissed(true);
  }

  async function turnOn() {
    setError(null);
    try {
      await turnOnPush();
    } catch (err) {
      setError((err as Error).message);
    }
    setStatus(await pushStatus().catch(() => 'unsupported' as const));
  }

  return (
    <div className="card push-banner">
      <div className="grow">
        {status === 'off' ? (
          <>
            <strong>Get notified when friends bet you.</strong>
            <div className="muted small">Takes, results and trash talk, too.</div>
          </>
        ) : (
          <>
            <strong>Want notifications?</strong>
            <div className="muted small">
              Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>, and open Bets from there.
            </div>
          </>
        )}
        <ErrorNote message={error} />
      </div>
      {status === 'off' && (
        <button className="btn primary" onClick={turnOn}>
          Turn on
        </button>
      )}
      <button className="dismiss" aria-label="Dismiss" onClick={dismiss}>
        &times;
      </button>
    </div>
  );
}

export function OfflineBar() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online) return null;
  return <div className="offline-bar">You&rsquo;re offline. Changes won&rsquo;t save until you&rsquo;re back.</div>;
}
