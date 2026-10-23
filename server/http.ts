export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function str(value: unknown, field: string, { min = 1, max = 200 } = {}): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (s.length < min) throw new HttpError(400, min <= 1 ? `${field} is required.` : `${field} must be at least ${min} characters.`);
  if (s.length > max) throw new HttpError(400, `${field} must be at most ${max} characters.`);
  return s;
}

export function optionalStr(value: unknown, field: string, max = 1000): string {
  if (value === undefined || value === null || value === '') return '';
  return str(value, field, { min: 0, max });
}

export function id(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'Not found.');
  return n;
}

const USERNAME_RE = /^[a-z0-9_]{3,20}$/i;
// Venmo usernames are 5-30 letters, numbers, hyphens and underscores.
const VENMO_RE = /^[a-z0-9_-]{5,30}$/i;

export function username(value: unknown): string {
  const s = str(value, 'Username', { max: 20 }).replace(/^@/, '');
  if (!USERNAME_RE.test(s)) throw new HttpError(400, 'Username must be 3-20 letters, numbers or underscores.');
  return s;
}

export function venmoUsername(value: unknown): string {
  const s = str(value, 'Venmo username', { max: 31 }).replace(/^@/, '');
  if (!VENMO_RE.test(s)) {
    throw new HttpError(400, 'That doesn’t look like a Venmo username (5-30 letters, numbers, - or _).');
  }
  return s;
}

const MAX_BET_CENTS = 1_000_000;

export function amountCents(value: unknown): number {
  const dollars = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[$,\s]/g, ''));
  if (!Number.isFinite(dollars) || dollars <= 0) throw new HttpError(400, 'Enter an amount greater than $0.');
  const cents = Math.round(dollars * 100);
  if (cents < 100) throw new HttpError(400, 'Minimum bet is $1.');
  if (cents > MAX_BET_CENTS) throw new HttpError(400, 'Maximum bet is $10,000.');
  return cents;
}

export function optionalDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new HttpError(400, 'Invalid date.');
  return s;
}
