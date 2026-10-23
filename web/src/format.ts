const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatMoney(cents: number): string {
  return money.format(cents / 100).replace(/\.00$/, '');
}

export function formatSignedMoney(cents: number): string {
  if (cents === 0) return '$0';
  return (cents > 0 ? '+' : '−') + formatMoney(Math.abs(cents));
}

// The API stores UTC timestamps as "YYYY-MM-DD HH:MM:SS".
export function parseTimestamp(ts: string): Date {
  return new Date(ts.replace(' ', 'T') + 'Z');
}

export function timeAgo(ts: string): string {
  const seconds = Math.round((Date.now() - parseTimestamp(ts).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return parseTimestamp(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
