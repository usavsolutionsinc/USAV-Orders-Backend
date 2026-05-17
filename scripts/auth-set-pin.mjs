#!/usr/bin/env node
// Local CLI to set or change a staff member's PIN.
//
// Usage:
//   node scripts/auth-set-pin.mjs <staffId> <pin>
//
// Re-uses src/lib/auth/pin.ts so the hash format matches what the runtime
// expects byte-for-byte. Reads DATABASE_URL from .env via dotenv.
//
// Intended for the first admin's bootstrap PIN before the /settings/staff
// admin UI is wired (Phase 4 onward). Don't use this in prod for routine
// PIN changes — staff change PINs via /api/auth/pin instead.

import 'dotenv/config';
import { scrypt as scryptCb, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';

const scrypt = promisify(scryptCb);

// Mirror src/lib/auth/pin.ts. If you change the params there, mirror here.
const N = 1 << 15;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALTLEN = 16;
const MAXMEM = 128 * 1024 * 1024;

async function hashPin(pin) {
  if (!/^\d{4,12}$/.test(pin)) {
    throw new Error('PIN must be 4–12 digits.');
  }
  const salt = randomBytes(SALTLEN);
  const key = await scrypt(pin, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function main() {
  const [staffIdRaw, pin] = process.argv.slice(2);
  if (!staffIdRaw || !pin) {
    console.error('Usage: node scripts/auth-set-pin.mjs <staffId> <pin>');
    process.exit(2);
  }
  const staffId = Number(staffIdRaw);
  if (!Number.isFinite(staffId) || staffId <= 0) {
    console.error('staffId must be a positive integer.');
    process.exit(2);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const pinHash = await hashPin(pin);
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const r = await client.query(
      `UPDATE staff
          SET pin_hash = $2,
              pin_set_at = NOW(),
              pin_failed_count = 0,
              pin_locked_until = NULL,
              status = COALESCE(NULLIF(status, ''), 'active')
        WHERE id = $1
        RETURNING id, name, role, status`,
      [staffId, pinHash],
    );
    if (r.rowCount === 0) {
      console.error(`No staff row with id=${staffId}`);
      process.exit(1);
    }
    const row = r.rows[0];
    console.log(`✓ PIN set for staff #${row.id} (${row.name}) — role=${row.role}, status=${row.status}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
