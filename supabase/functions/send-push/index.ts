// Supabase Edge Function: sends the push notifications waiting in push_outbox
// (see supabase/migrations/003_push_notifications.sql). The database pings it
// whenever it queues some. It reads no input and only sends what's already
// queued, so it's safe to deploy with "Verify JWT" turned off.
//
// One file on purpose, so it can be pasted straight into the Supabase
// dashboard editor. The first half is a small Web Push sender: message
// encryption (RFC 8291, aes128gcm from RFC 8188) and VAPID signing (RFC 8292)
// using only Web Crypto and fetch.
//
// Secret to set on the function: VAPID_PRIVATE_KEY, the private half of the
// push key pair (a JWK as JSON). Supabase supplies SUPABASE_URL and its own
// secret key automatically.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

// ============================================================
// Web Push
// ============================================================

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

// The VAPID key pair as a private JWK (x and y are the public half).
export type Vapid = { privateJWK: JsonWebKey; subject: string };

const encoder = new TextEncoder();

function fromBase64Url(s: string): Uint8Array {
  const base64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

// Encrypts a payload for one browser as a single aes128gcm record.
export async function encryptPayload(p256dh: string, auth: string, plaintext: Uint8Array): Promise<Uint8Array> {
  const browserPublic = fromBase64Url(p256dh);
  const authSecret = fromBase64Url(auth);

  // A fresh key pair per message; the browser derives the same secret from
  // our public half (sent in the header) and its own private key.
  const ours = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ourPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ours.publicKey));
  const browserKey = await crypto.subtle.importKey('raw', browserPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: browserKey }, ours.privateKey, 256),
  );

  const ikm = await hkdf(authSecret, sharedSecret, concat(encoder.encode('WebPush: info\0'), browserPublic, ourPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const contentKey = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt']);
  // 0x02 marks the last (and only) record; no extra padding.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))),
  );

  // Header: salt (16) | record size (4) | key id length (1) | key id (our public key).
  const header = new Uint8Array(21 + ourPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = ourPublic.length;
  header.set(ourPublic, 21);
  return concat(header, ciphertext);
}

// The Authorization header proving this server owns the key the browser subscribed with.
export async function vapidAuthorization(endpoint: string, vapid: Vapid): Promise<string> {
  const { x, y, d } = vapid.privateJWK;
  if (!x || !y || !d) throw new Error('The VAPID private key must be an EC P-256 JWK with x, y and d.');
  const publicKey = concat(new Uint8Array([4]), fromBase64Url(x), fromBase64Url(y));

  const header = toBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = toBase64Url(
    encoder.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: vapid.subject,
      }),
    ),
  );
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x, y, d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ]);
  // Web Crypto signs in the raw r||s form that JWT's ES256 expects.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(`${header}.${claims}`)),
  );
  return `vapid t=${header}.${claims}.${toBase64Url(signature)}, k=${toBase64Url(publicKey)}`;
}

export async function sendWebPush(
  target: PushTarget,
  payload: unknown,
  vapid: Vapid,
  options: { ttl: number; urgency: 'very-low' | 'low' | 'normal' | 'high' } = { ttl: 3600, urgency: 'high' },
): Promise<Response> {
  if (!target.endpoint.startsWith('https://')) throw new Error('Push endpoints must use HTTPS.');
  const body = await encryptPayload(target.p256dh, target.auth, encoder.encode(JSON.stringify(payload)));
  return fetch(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(options.ttl),
      Urgency: options.urgency,
    },
    body,
  });
}

// ============================================================
// The function
// ============================================================

// Push services use this to reach whoever runs the sender if something's wrong.
const ADMIN_CONTACT = 'https://ajcachiaras.github.io/bet-with-friends/';

type Queued = {
  subscription_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body: string;
  url: string;
  tag: string | null;
};

// Newer projects expose secret keys as JSON ({"default": "sb_secret_..."});
// older ones as SUPABASE_SERVICE_ROLE_KEY.
function databaseKey(): string | undefined {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, string>;
      return parsed.default ?? Object.values(parsed)[0];
    } catch {
      // fall through to the legacy key
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
}

export async function handler(): Promise<Response> {
  const privateJWK = Deno.env.get('VAPID_PRIVATE_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const key = databaseKey();
  if (!privateJWK || !supabaseUrl || !key) {
    return Response.json({ error: 'VAPID_PRIVATE_KEY or the Supabase settings are missing.' }, { status: 500 });
  }
  let vapid: Vapid;
  try {
    vapid = { privateJWK: JSON.parse(privateJWK), subject: ADMIN_CONTACT };
  } catch {
    return Response.json({ error: 'VAPID_PRIVATE_KEY must be the JSON key, pasted exactly.' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc('claim_push_outbox');
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const queued = (data ?? []) as Queued[];

  const gone: number[] = [];
  let sent = 0;
  await Promise.all(
    queued.map(async (q) => {
      try {
        const response = await sendWebPush(
          { endpoint: q.endpoint, p256dh: q.p256dh, auth: q.auth },
          { title: q.title, body: q.body, url: q.url, tag: q.tag },
          vapid,
        );
        if (response.status === 404 || response.status === 410) {
          // The device unsubscribed or the browser was reset.
          gone.push(q.subscription_id);
        } else if (response.ok) {
          sent++;
        } else {
          console.error(`Push to ${new URL(q.endpoint).host} failed: ${response.status} ${await response.text()}`);
        }
      } catch (err) {
        console.error('Push failed:', err);
      }
    }),
  );

  if (gone.length) await supabase.rpc('delete_push_subscriptions', { p_ids: gone });
  return Response.json({ queued: queued.length, sent, removed: gone.length });
}

Deno.serve(handler);
