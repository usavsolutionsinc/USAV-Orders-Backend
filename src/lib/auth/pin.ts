/**
 * PIN hashing + verification + lockout.
 *
 * scrypt over argon2id because we don't want a native module: this code runs
 * in Next.js API routes (Node runtime) and node:crypto.scrypt is always there.
 * scrypt with the params below takes ~80–120ms on a modern laptop — fast
 * enough for an interactive sign-in, slow enough to slow down a leaked-DB
 * offline attack to "many lifetimes" for any 6-digit PIN combined with the
 * lockout below.
 *
 * Storage format (single text column `staff.pin_hash`):
 *   scrypt$N$r$p$saltHex$keyHex
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import pool from '@/lib/db';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;

const N = 1 << 15; // 32 768 — ~32MB memory cost
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALTLEN = 16;
// node default maxmem ≈ 32MB, so we bump it; otherwise scrypt() throws ERR_CRYPTO_INVALID_SCRYPT_PARAMS.
const MAXMEM = 128 * 1024 * 1024;

const MIN_PIN_LEN = 4;
const MAX_PIN_LEN = 12;
const LOCKOUT_FAIL_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export class PinError extends Error {
  constructor(public readonly code: 'TOO_SHORT' | 'TOO_LONG' | 'NOT_NUMERIC' | 'LOCKED' | 'NO_PIN' | 'WRONG' | 'NOT_FOUND' | 'WEAK_PIN' | 'PIN_ALREADY_SET') {
    super(code);
    this.name = 'PinError';
  }
}

function assertPinShape(pin: string): void {
  if (pin.length < MIN_PIN_LEN) throw new PinError('TOO_SHORT');
  if (pin.length > MAX_PIN_LEN) throw new PinError('TOO_LONG');
  if (!/^\d+$/.test(pin))      throw new PinError('NOT_NUMERIC');
}

/**
 * Reject the most fat-finger-easy PINs (all same digit, straight ascending or
 * descending sequence). Not a substitute for the scrypt+lockout combo — just a
 * UX nudge during PIN creation. Returns true if the PIN is too obvious.
 */
export function isObviousPin(pin: string): boolean {
  if (pin.length < MIN_PIN_LEN) return false; // shape error takes priority
  if (/^(\d)\1+$/.test(pin)) return true;       // 0000, 1111, …
  let asc = true, desc = true;
  for (let i = 1; i < pin.length; i++) {
    const d = pin.charCodeAt(i) - pin.charCodeAt(i - 1);
    if (d !== 1) asc = false;
    if (d !== -1) desc = false;
  }
  return asc || desc;
}

export async function hashPin(pin: string): Promise<string> {
  assertPinShape(pin);
  const salt = randomBytes(SALTLEN);
  const key = await scrypt(pin, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyHash(pin: string, stored: string): Promise<boolean> {
  // stored = scrypt$N$r$p$saltHex$keyHex
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N_ = Number(parts[1]);
  const R_ = Number(parts[2]);
  const P_ = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'hex');
  const expected = Buffer.from(parts[5], 'hex');
  if (!Number.isFinite(N_) || !Number.isFinite(R_) || !Number.isFinite(P_)) return false;
  const got = await scrypt(pin, salt, expected.length, { N: N_, r: R_, p: P_, maxmem: MAXMEM });
  if (got.length !== expected.length) return false;
  return timingSafeEqual(got, expected);
}

/**
 * Set or change a staff member's PIN. Caller is responsible for authz
 * (admin reset vs self-change). Clears lockout state on success.
 */
export async function setStaffPin(staffId: number, pin: string): Promise<void> {
  const pinHash = await hashPin(pin);
  await pool.query(
    `UPDATE staff
       SET pin_hash = $2,
           pin_set_at = NOW(),
           pin_failed_count = 0,
           pin_locked_until = NULL
     WHERE id = $1`,
    [staffId, pinHash],
  );
}

interface StaffPinRow {
  id: number;
  name: string;
  role: string;
  status: string;
  pin_hash: string | null;
  pin_failed_count: number;
  pin_locked_until: Date | null;
  default_home_path: string | null;
}

/**
 * Look up by ID and verify PIN. Returns the staff row on success.
 * Throws PinError on every failure path; callers map to HTTP codes.
 */
export async function verifyStaffPin(staffId: number, pin: string): Promise<StaffPinRow> {
  assertPinShape(pin);
  const result = await pool.query(
    `SELECT id, name, role, status, pin_hash, pin_failed_count, pin_locked_until, default_home_path
       FROM staff
      WHERE id = $1
      LIMIT 1`,
    [staffId],
  );
  const row = result.rows[0] as StaffPinRow | undefined;
  if (!row) throw new PinError('NOT_FOUND');
  if (!row.pin_hash) throw new PinError('NO_PIN');

  if (row.pin_locked_until && row.pin_locked_until.getTime() > Date.now()) {
    throw new PinError('LOCKED');
  }

  const ok = await verifyHash(pin, row.pin_hash);
  if (!ok) {
    const nextCount = (row.pin_failed_count || 0) + 1;
    if (nextCount >= LOCKOUT_FAIL_THRESHOLD) {
      await pool.query(
        `UPDATE staff
            SET pin_failed_count = $2,
                pin_locked_until = NOW() + ($3 || ' milliseconds')::INTERVAL
          WHERE id = $1`,
        [staffId, nextCount, String(LOCKOUT_WINDOW_MS)],
      );
      throw new PinError('LOCKED');
    } else {
      await pool.query(
        `UPDATE staff SET pin_failed_count = $2 WHERE id = $1`,
        [staffId, nextCount],
      );
      throw new PinError('WRONG');
    }
  }

  // Success → clear counter, bump last_login_at
  await pool.query(
    `UPDATE staff
        SET pin_failed_count = 0,
            pin_locked_until = NULL,
            last_login_at    = NOW()
      WHERE id = $1`,
    [staffId],
  );
  return row;
}
