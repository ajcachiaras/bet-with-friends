// Push notifications and installing to the home screen. Browsers differ a lot
// here, so every state ends in a clear explanation rather than an error.
import { api } from './api';
import { VAPID_PUBLIC_KEY } from './config';

export type PushStatus =
  | 'unsupported' // this browser can't do web push
  | 'install-first' // iPhone/iPad: only works once added to the Home Screen
  | 'blocked' // the person said no; only their settings can undo it
  | 'off'
  | 'on';

export function isIos(): boolean {
  // iPadOS reports itself as a Mac, but Macs don't have touch screens.
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

export function isInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

function toTarget(subscription: PushSubscription) {
  const json = subscription.toJSON();
  return { endpoint: subscription.endpoint, p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' };
}

function fromBase64Url(s: string): Uint8Array {
  const base64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

export async function pushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return isIos() && !isInstalled() ? 'install-first' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' && (await currentSubscription()) ? 'on' : 'off';
}

// Call straight from a tap: browsers only show the permission prompt then.
export async function turnOnPush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission === 'denied') throw new Error('Notifications are blocked. Allow them for this app in your settings.');
  if (permission !== 'granted') throw new Error('Notifications weren’t turned on.');
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(VAPID_PUBLIC_KEY) }));
  await api.savePushSubscription(toTarget(subscription));
}

export async function turnOffPush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await api.deletePushSubscription(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe();
}

// After signing in: if this device already has notifications on, point them
// at whoever is signed in now (a shared phone follows its current login).
export async function claimDevice(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const subscription = await currentSubscription();
  if (subscription) await api.savePushSubscription(toTarget(subscription));
}

// Before logging out: stop this device getting the old account's notifications.
// The browser keeps its subscription, so the next login can claim it.
export async function releaseDevice(): Promise<void> {
  const subscription = await currentSubscription();
  if (subscription) await api.deletePushSubscription(subscription.endpoint).catch(() => undefined);
}

// ---------- Install prompt ----------

// Chrome and Edge offer a real install prompt through this event. Hold on to
// it so a button can show it later. Safari has no equivalent.
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };

let installPrompt: InstallPromptEvent | null = null;
const installListeners = new Set<() => void>();
const notifyInstall = () => installListeners.forEach((fn) => fn());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as InstallPromptEvent;
  notifyInstall();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  notifyInstall();
});

export function canPromptInstall(): boolean {
  return installPrompt !== null;
}

export function onInstallPromptChange(fn: () => void): () => void {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}

export async function promptInstall(): Promise<void> {
  if (!installPrompt) return;
  await installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  notifyInstall();
}
