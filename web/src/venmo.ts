// Venmo retired its public developer API, so no third-party app can create a
// payment request on someone's behalf. What still works is Venmo's documented
// payment-link format: it opens Venmo (the app on phones, the website on
// desktop) with the recipient, amount and note already filled in, and the user
// taps once to send it.
//
//   https://venmo.com/<username>?txn=charge&amount=20.00&note=...
//
// txn=charge creates a request, txn=pay a payment. Everything that builds a
// Venmo link goes through here so the format lives in one place.

type VenmoLink = {
  txn: 'charge' | 'pay';
  username: string;
  amountCents: number;
  note: string;
};

const MAX_NOTE_LENGTH = 200;

export function venmoUrl({ txn, username, amountCents, note }: VenmoLink): string {
  const params = new URLSearchParams({
    txn,
    amount: (amountCents / 100).toFixed(2),
    note: note.slice(0, MAX_NOTE_LENGTH),
    audience: 'private',
  });
  return `https://venmo.com/${encodeURIComponent(username)}?${params}`;
}

export function venmoProfileUrl(username: string): string {
  return `https://venmo.com/${encodeURIComponent(username)}`;
}
