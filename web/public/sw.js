// Service worker: shows push notifications and keeps a copy of the app for
// when the network drops. It sits at the app's root so it covers every page.

const CACHE = 'bwf-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

// The page and its built files come from the network when possible, and from
// the last saved copy when not. Everything else (Supabase, the dev server's
// modules) goes straight to the network untouched.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin) return;

  const isPage = request.mode === 'navigate';
  const isBuiltFile = url.pathname.startsWith(`${scope.pathname}assets/`) || url.pathname.startsWith(`${scope.pathname}icons/`);
  if (!isPage && !isBuiltFile) return;

  // Every page is the same index.html (routes live after the #).
  const key = isPage ? scope.href : request;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(key, response.clone());
        return response;
      } catch (err) {
        const saved = await cache.match(key);
        if (saved) return saved;
        throw err;
      }
    })(),
  );
});

// Payloads come from the send-push Supabase function: { title, body, url, tag },
// where url is an app route such as "/bets/12".
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Bet with Friends', {
      body: data.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = event.notification.data?.url || '/';
  const target = `${self.registration.scope}#${route}`;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => w.url.startsWith(self.registration.scope));
      if (open) {
        await open.focus();
        open.postMessage({ type: 'open-route', route });
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
