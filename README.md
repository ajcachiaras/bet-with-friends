# Bet with Friends

A social app for making bets with your friends and settling up on Venmo.

- **Groups.** Start a group and share the invite link or code with your friends.
- **Bets.** Pick someone in the group, write what the bet is, choose sides, set an amount and optionally a "settle by" date.
- **Results.** Either person reports the result and the other confirms it. Admitting you lost settles the bet straight away, and a disputed result goes back for another report.
- **Venmo.** The winner gets a **Request on Venmo** button and the loser gets a **Pay on Venmo** button. Each opens Venmo with the person, amount and note already filled in. Either person can then mark the bet paid.
- **Social.** Each bet has a comment thread, each group has a leaderboard (net winnings and win/loss record), and the home screen shows a "Your move" list of what's waiting on you.

## Run it

Requires Node 20+.

```bash
npm install
npm run seed   # optional: demo users alex, sam and jordan in a "Sunday Crew" group
npm run dev    # http://localhost:5173
```

The demo accounts' password is in `server/seed.ts`. To start fresh, delete the `data/` folder.

For production, run `npm run build`, then `npm start`. A single server then serves the API and the built app on `$PORT` (default 3001). The SQLite database goes in `$DATA_DIR` (default `./data`).

## How the Venmo part works (and why it works this way)

Venmo [retired its public developer API](https://venmo.com/docs/payments), so **no third-party app can send a Venmo request or payment for a user**. The only supported way to start one is a Venmo payment link:

```
https://venmo.com/<username>?txn=charge&amount=20.00&note=Chiefs+vs+Bills&audience=private
```

`txn=charge` makes a request and `txn=pay` makes a payment. On a phone with Venmo installed the link opens the app, and on desktop it opens venmo.com. The user still taps **Request** or **Pay** in Venmo themselves, so Venmo stays in control of the money and this app never touches it. All link-building is in [`web/src/venmo.ts`](web/src/venmo.ts).

As a result, the app can't know whether a payment actually went through. People mark bets paid themselves.

## Project layout

```
server/            Express API + SQLite (better-sqlite3)
  db.ts            schema
  bets.ts          bet state machine: who can do what, and when
  routes.ts        HTTP endpoints
  auth.ts          password hashing (scrypt) and cookie sessions
  seed.ts          demo data
web/src/           React app (Vite)
  pages/           Home, Group, New bet, Bet, Profile, Auth, Join
  venmo.ts         Venmo link builder
```

Bet lifecycle: `proposed → active → reported → settled` (plus `declined`, `cancelled`, and `disputed → reported`). The server decides which actions each person can take and sends them as `bet.actions`, so the UI only shows buttons that will work.

## Before launching this for real

1. **Venmo's terms.** Venmo's User Agreement and Acceptable Use Policy restrict payments related to gambling. Accounts can be limited or closed for activity Venmo sees as violating them. Read the current terms at venmo.com/legal, and consider contacting PayPal/Venmo, before building a business on this.
2. **Gambling law.** Rules on betting between people, and on apps that help them do it, vary by state and country. This app never holds money and takes no cut, but get legal advice before a public launch. Add an age gate too.
3. **Production hardening.** Still needed: rate limiting on login, password reset, push or email notifications (for example "Sam accepted your bet"), HTTPS, and probably Postgres in place of SQLite if you run more than one server.
4. **Native app.** The UI is built for phones. To get it into the App Store or Play Store, wrap it with Capacitor, or rebuild the screens in React Native against the same API.
