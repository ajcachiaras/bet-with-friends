# Bet with Friends

A social app for making friendly bets with your crew and keeping score. Bets are for points, which aren't worth any money.

- **Groups.** Start a group and share the invite link or code with your friends.
- **Bets.** Pick someone in the group, write what the bet is, choose sides, set the points at stake and optionally a "settle by" date.
- **Results.** Either person reports the result and the other confirms it. Admitting you lost settles the bet straight away, and a disputed result goes back for another report.
- **Social.** Each bet has a comment thread, each group has a leaderboard (net points and win/loss record), and the home screen shows a "Your move" list of what's waiting on you.

Live at **https://ajcachiaras.github.io/bet-with-friends/**

## How it's built

- **Front end:** React + Vite, a static site hosted on GitHub Pages. Every push to `main` redeploys it (`.github/workflows/deploy.yml`).
- **Back end:** [Supabase](https://supabase.com) (Postgres + accounts). There's no server of our own: the browser talks to Supabase directly.
- **Security:** row level security in [`supabase/schema.sql`](supabase/schema.sql) means you only ever see groups you're in. Every change to a group or bet goes through database functions that enforce the rules (only the opponent can accept, nobody confirms their own result, and so on).

## Setting up a Supabase project

1. Create a project at supabase.com. Leave **Enable Data API** on.
2. **SQL Editor** → new query → paste all of `supabase/schema.sql` → **Run**.
3. **Authentication → Sign In / Providers → Email:** turn off **Confirm email**. Supabase's built-in mailer only sends to the project's own team, so friends would never get a confirmation link.
4. **Authentication → URL Configuration:** set **Site URL** to the GitHub Pages address.
5. Copy the **Project URL** and **publishable key** (the **Connect** button, or **Project Settings → API Keys**) into [`web/src/config.ts`](web/src/config.ts). Both are safe to commit. Never commit the secret key or the database password.
6. On GitHub: **Settings → Pages → Source: GitHub Actions**.

## Run it locally

```bash
npm install
npm run dev    # http://localhost:5173, using the Supabase project in web/src/config.ts
```

## Project layout

```
supabase/schema.sql   tables, security rules and the bet functions (run once in Supabase)
web/src/
  api.ts              all reads and writes
  bets.ts             what each person can do on a bet (mirrors the database rules)
  config.ts           Supabase URL + publishable key
  pages/              Home, Group, New bet, Bet, Profile, Auth, Join
```

Bet lifecycle: `proposed → active → reported → settled` (plus `declined`, `cancelled`, and `disputed → reported`).

## Free-tier note

Supabase pauses free projects after a week with no activity. Data is kept. Restore the project from the Supabase dashboard and the site works again.
