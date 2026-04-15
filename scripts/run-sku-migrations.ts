/**
 * Runner for the 2026-04-15 sku retirement + ledger-SoT migrations.
 *
 * Executes in order, each inside its own transaction. Prints a row-count
 * summary + drift check at the end so you can see whether the backfill and
 * invariants landed correctly.
 *
 * Usage: npx tsx scripts/run-sku-migrations.ts
 * Requires: DATABASE_URL in env.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const ROOT = process.cwd();
const MIGRATIONS = [
  'src/lib/migrations/2026-04-10_create_serial_units.sql',
  'src/lib/migrations/2026-04-11_add_serial_unit_fk.sql',
  'src/lib/migrations/2026-04-15_retire_sku_table.sql',
  'src/lib/migrations/2026-04-15_sku_stock_ledger_authoritative.sql',
];

const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function runMigration(path: string): Promise<void> {
  const sql = readFileSync(join(ROOT, path), 'utf8');
  console.log(`\n── Running ${path} ────────────────────────────────`);
  const t0 = Date.now();
  const client = await pool.connect();
  try {
    // Each migration file opens its own BEGIN…COMMIT, so we don't wrap again.
    await client.query(sql);
    console.log(`   ✔ done in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`   ✘ failed: ${(err as Error).message}`);
    throw err;
  } finally {
    client.release();
  }
}

async function verify(): Promise<void> {
  console.log(`\n── Verification ──────────────────────────────────────────`);
  const q = async (label: string, sql: string) => {
    const { rows } = await pool.query(sql);
    console.log(`  ${label}:`, rows.length === 1 ? rows[0] : rows);
  };

  await q(
    'sku row count',
    `SELECT COUNT(*)::int AS n FROM sku`,
  );
  await q(
    'serial_units rows (origin_source=legacy)',
    `SELECT COUNT(*)::int AS n FROM serial_units WHERE origin_source = 'legacy'`,
  );
  await q(
    'v_sku row count',
    `SELECT COUNT(*)::int AS n FROM v_sku`,
  );
  await q(
    'sku_stock row count',
    `SELECT COUNT(*)::int AS n FROM sku_stock`,
  );
  await q(
    'sku_stock_ledger INITIAL_BALANCE rows',
    `SELECT COUNT(*)::int AS n FROM sku_stock_ledger WHERE reason = 'INITIAL_BALANCE'`,
  );
  await q(
    'drift (should be empty)',
    `SELECT * FROM v_sku_stock_drift LIMIT 10`,
  );

  // Smoke: sku INSERT is blocked
  try {
    await pool.query(`INSERT INTO sku (static_sku) VALUES ('__MIGRATION_VERIFY__')`);
    console.log(`  ✘ sku INSERT was NOT blocked — freeze trigger missing!`);
  } catch (err) {
    const msg = (err as Error).message;
    if (/retired|frozen|blocked/i.test(msg)) {
      console.log(`  ✔ sku INSERT blocked: "${msg.split('\n')[0]}"`);
    } else {
      console.log(`  ? sku INSERT failed for unknown reason: ${msg}`);
    }
  }
}

async function main() {
  const host = DATABASE_URL!.match(/@([^/]+)\//)?.[1] ?? '(unknown)';
  console.log(`Target DB host: ${host}`);

  for (const m of MIGRATIONS) {
    await runMigration(m);
  }
  await verify();
  await pool.end();
  console.log(`\nAll done.`);
}

main().catch((err) => {
  console.error('\nMigration run failed:', err);
  pool.end().finally(() => process.exit(1));
});
