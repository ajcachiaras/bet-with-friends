# Bet with Friends

A social app for making friendly bets with your crew and keeping score. Bets are for points, which aren't worth any money.

- **Groups.** Start a group and share the invite link or code with your friends.
- **Bets.** Pick someone in the group, write what the bet is, choose sides, set the points at stake and optionally a "settle by" date.
- **Open bets.** Or don't pick anyone: put your side up on the group board, and the first member to take the other side is your opponent.
- **Odds.** Each side can put up a different stake, and the winner collects the loser's. Back a long shot by risking 10 to win 50.
- **Counters.** Instead of accepting a bet, change anything about it and send it back. The other person can accept, decline or counter again. Countering an open bet takes it off the board while you two work it out; if either of you declines, it goes back up as originally posted.
- **Results.** Either person reports the result and the other confirms it. Admitting you lost settles the bet straight away, and a disputed result goes back for another report.
- **Social.** Each bet has a comment thread, each group has a leaderboard (net points and win/loss record), and the home screen shows a "Your move" list of what's waiting on you.
- **App and notifications.** Add it to your home screen and it opens like an app, even offline. Turn on notifications (Profile) to hear when someone bets you, takes your bet, reports a result or comments. On iPhone, notifications work once it's on the Home Screen (iOS 16.4+).

Live at **https://ajcachiaras.github.io/bet-with-friends/**

## How it's built

- **Front end:** React + Vite, a static site hosted on GitHub Pages. Every push to `main` redeploys it (`.github/workflows/deploy.yml`).
- **Back end:** [Supabase](https://supabase.com) (Postgres + accounts). There's no server of our own: the browser talks to Supabase directly.
- **Security:** row level security in [`supabase/migrations`](supabase/migrations) means you only ever see groups you're in. Every change to a group or bet goes through database functions that enforce the rules (only the opponent can accept, nobody confirms their own result, and so on).
- **Notifications:** database triggers queue a message for each person who should hear about a change, then ping the `send-push` Edge Function ([`supabase/functions/send-push`](supabase/functions/send-push/index.ts)), which sends them with Web Push. A service worker (`web/public/sw.js`) shows them and keeps the app working offline.

## Setting up a Supabase project

1. Create a project at supabase.com. Leave **Enable Data API** on.
2. **SQL Editor:** run each file in `supabase/migrations` once, in order (paste it into a new query → **Run**). When a new migration is added later, run just that one.
3. **Authentication → Sign In / Providers → Email:** turn off **Confirm email**. Supabase's built-in mailer only sends to the project's own team, so friends would never get a confirmation link.
4. **Authentication → URL Configuration:** set **Site URL** to the GitHub Pages address.
5. Copy the **Project URL** and **publishable key** (the **Connect** button, or **Project Settings → API Keys**) into [`web/src/config.ts`](web/src/config.ts). Both are safe to commit. Never commit the secret key or the database password.
6. On GitHub: **Settings → Pages → Source: GitHub Actions**.
7. **Notifications:**
   - Generate a VAPID key pair (P-256). Put the public key in `VAPID_PUBLIC_KEY` in `web/src/config.ts`.
   - **Edge Functions → Deploy a new function → Via Editor:** name it `send-push` and paste in `supabase/functions/send-push/index.ts`. Turn off JWT verification for it; it only sends what the database already queued.
   - **Edge Functions → Secrets:** add `VAPID_PRIVATE_KEY` with the private key as a JWK (JSON). Keep it out of git: files named `*.local.*` are ignored for this.
   - Migration 003 points the database at `https://<project>.supabase.co/functions/v1/send-push`. Change that address if you use a different project.

## Run it locally

```bash
npm install
npm run dev    # http://localhost:5173, using the Supabase project in web/src/config.ts
```

## Project layout

```
supabase/migrations/  tables, security rules, bet functions, notification triggers (run each once, in order)
supabase/functions/   send-push: the Edge Function that sends notifications
web/public/           manifest, icons, and sw.js (service worker)
web/src/
  api.ts              all reads and writes
  bets.ts             what each person can do on a bet (mirrors the database rules)
  push.ts             notifications on/off and the install prompt
  config.ts           Supabase URL, publishable key, push public key
  pages/              Home, Group, New bet, Bet, Profile, Auth, Join
```

Bet lifecycle: `proposed → active → reported → settled`, or `open → active` when someone takes an open bet (plus `declined`, `cancelled`, and `disputed → reported`). A counter keeps a bet `proposed` and passes the turn (`proposed_by`); every version of the terms is kept in `bet_offers`.

## Free-tier note

Supabase pauses free projects after a week with no activity. Data is kept. Restore the project from the Supabase dashboard and the site works again.
