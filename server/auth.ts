import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db, type UserRow } from './db.js';
import { HttpError } from './http.js';

const SESSION_COOKIE = 'bwf_session';
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// Only a hash of the session token is stored, so a leaked database can't be
// used to impersonate anyone.
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function startSession(res: Response, userId: number): void {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token_hash, user_id) VALUES (?, ?)').run(hashToken(token), userId);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE_MS,
  });
}

export function endSession(req: Request, res: Response): void {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  res.clearCookie(SESSION_COOKIE);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
    }
  }
}

export function loadUser(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    req.user = db
      .prepare(
        `SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
         WHERE sessions.token_hash = ? AND sessions.created_at > datetime('now', '-30 days')`,
      )
      .get(hashToken(token)) as UserRow | undefined;
  }
  next();
}

export function requireUser(req: Request): UserRow {
  if (!req.user) throw new HttpError(401, 'Please log in.');
  return req.user;
}
