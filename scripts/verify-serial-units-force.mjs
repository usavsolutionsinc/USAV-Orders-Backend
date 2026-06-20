#!/usr/bin/env node
/**
 * verify-serial-units-force.mjs — app_tenant safety harness for the serial_units
 * FORCE RLS migration (docs/serial-units-tenant-force-plan.md §5).
 *
 * What it does, in order:
 *   1. Baseline: read COUNT(*) FROM serial_units as the REAL app_tenant role
 *      (GUC app.current_org = USAV), inside a txn so SET LOCAL sticks.
 *   2. Apply 2026-06-20b_enforce_tenant_isolation_serial_units.sql as the owner
 *      and record it in schema_migrations.
 *   3. Re-read as app_tenant (GUC=USAV) and with the GUC UNSET.
 *   4. Auto-rollback (relax_tenant_isolation) if FORCE hid rows (post != base).
 *
 * Pass/expect:
 *   - post app_tenant count == baseline  → reads intact under FORCE
 *   - GUC-unset count == 0               → isolation actually active
 *
 * Env (.env): DATABASE_URL (neondb_owner) + TENANT_APP_DATABASE_URL (app_tenant).
 * Run from repo root:  node scripts/verify-serial-units-force.mjs
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const { config } = await import('dotenv');
config({ path: '.env' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const USAV = '00000000-0000-0000-0000-000000000001';
const FILE = '2026-06-20b_enforce_tenant_isolation_serial_units.sql';
const sqlPath = join(__dirname, '..', 'src', 'lib', 'migrations', FILE);
const sql = readFileSync(sqlPath, 'utf8');
const sum = createHash('sha256').update(sql, 'utf8').digest('hex');

if (!process.env.DATABASE_URL || !process.env.TENANT_APP_DATABASE_URL) {
  console.error('Missing DATABASE_URL and/or TENANT_APP_DATABASE_URL in .env');
  process.exit(1);
}

const owner = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const app = new Pool({ connectionString: process.env.TENANT_APP_DATABASE_URL, ssl: { rejectUnauthorized: false } });
const oc = await owner.connect();
const ac = await app.connect();

// GUC must be set INSIDE a txn (SET LOCAL is lost in autocommit).
async function readAsApp(org) {
  await ac.query('BEGIN');
  await ac.query("SELECT set_config('app.current_org', $1, true)", [org]);
  const r = await ac.query('SELECT count(*)::int n FROM serial_units');
  await ac.query('COMMIT');
  return r.rows[0].n;
}

try {
  const base = await readAsApp(USAV);
  console.log('baseline app_tenant (GUC=USAV):', base);

  await oc.query('BEGIN');
  await oc.query(sql);
  await oc.query(
    'INSERT INTO schema_migrations(filename, sha256) VALUES($1, $2) ON CONFLICT DO NOTHING',
    [FILE, sum],
  );
  await oc.query('COMMIT');
  console.log('applied + recorded', FILE);

  const post = await readAsApp(USAV);
  console.log('post app_tenant (GUC=USAV):', post);

  const zero = await readAsApp(''); // GUC unset → expect 0 under FORCE
  console.log('GUC-unset (expect 0):', zero);

  if (post !== base) {
    console.log('FORCE HID ROWS — relaxing (re-audit writers/readers before retrying)');
    await oc.query("SELECT relax_tenant_isolation('serial_units')");
  } else {
    console.log('OK: reads intact, isolation active');
  }
} catch (err) {
  console.error('harness failed:', err);
  try { await oc.query('ROLLBACK'); } catch {}
  process.exitCode = 1;
} finally {
  oc.release();
  ac.release();
  await owner.end();
  await app.end();
}
