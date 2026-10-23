export function formatPoints(points: number): string {
  return `${points.toLocaleString()} ${points === 1 ? 'pt' : 'pts'}`;
}

export function formatSignedPoints(points: number): string {
  if (points === 0) return '0';
  return (points > 0 ? '+' : '−') + Math.abs(points).toLocaleString();
}

// Postgres sends ISO timestamps with microseconds ("2026-10-23T01:50:45.123456+00:00").
// Trim to milliseconds, which every browser parses.
export function parseTimestamp(ts: string): Date {
  return new Date(ts.replace(/(\.\d{3})\d+/, '$1'));
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
