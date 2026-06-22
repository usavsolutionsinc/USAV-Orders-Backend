/**
 * Account password hashing + verification.
 *
 * Uses the SAME scrypt scheme + storage format as PINs (src/lib/auth/pin.ts) so
 * there is one hashing primitive in the codebase and no native-module
 * dependency. Storage format (accounts.password_hash):
 *   scrypt$N$r$p$saltHex$keyHex
 *
 * Difference from PINs: passwords are free-form text with a length floor, not
 * 4–12 digits.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;

const N = 1 << 15; // 32 768 — ~32MB memory cost (matches pin.ts)
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALTLEN = 16;
const MAXMEM = 128 * 1024 * 1024;

export const MIN_PASSWORD_LEN = 8;
export const MAX_PASSWORD_LEN = 200;

export class PasswordError extends Error {
  constructor(public readonly code: 'TOO_SHORT' | 'TOO_LONG') {
    super(code);
    this.name = 'PasswordError';
  }
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LEN) throw new PasswordError('TOO_SHORT');
  if (password.length > MAX_PASSWORD_LEN) throw new PasswordError('TOO_LONG');
  const salt = randomBytes(SALTLEN);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N_ = Number(parts[1]);
  const R_ = Number(parts[2]);
  const P_ = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'hex');
  const expected = Buffer.from(parts[5], 'hex');
  if (!Number.isFinite(N_) || !Number.isFinite(R_) || !Number.isFinite(P_)) return false;
  const got = await scrypt(password, salt, expected.length, { N: N_, r: R_, p: P_, maxmem: MAXMEM });
  if (got.length !== expected.length) return false;
  return timingSafeEqual(got, expected);
}
