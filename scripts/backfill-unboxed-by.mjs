#!/usr/bin/env node
/**
 * Backfill receiving.unboxed_by for cartons that were unboxed before
 * mark-received started stamping the operator.
 *
 * Usage:
 *   node scripts/backfill-unboxed-by.mjs --staff-id 6 --dry-run
 *   node scripts/backfill-unboxed-by.mjs --staff-id 6
 */
import 'dotenv/config';
import pg from 'pg';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const staffArg = argv.indexOf('--staff-id');
const staffId = staffArg >= 0 ? Number(argv[staffArg + 1]) : 7;

if (!Number.isFinite(staffId) || staffId <= 0) {
  console.error('Invalid --staff-id');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const staffCheck = await pool.query(`SELECT id, name FROM staff WHERE id = $1`, [staffId]);
  if (staffCheck.rows.length === 0) {
    console.error(`staff id ${staffId} not found`);
    process.exit(1);
  }
  const staffName = staffCheck.rows[0].name;
  console.log(`Target staff: ${staffId} (${staffName})`);

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM receiving
      WHERE unboxed_at IS NOT NULL
        AND unboxed_by IS NULL`,
  );
  const toUpdate = countRes.rows[0]?.n ?? 0;
  console.log(`Rows to backfill (unboxed_at set, unboxed_by NULL): ${toUpdate}`);

  if (toUpdate === 0) {
    await pool.end();
    return;
  }

  if (dryRun) {
    const sample = await pool.query(
      `SELECT id, to_char(unboxed_at::timestamp, 'YYYY-MM-DD HH24:MI:SS') AS unboxed_at
         FROM receiving
        WHERE unboxed_at IS NOT NULL AND unboxed_by IS NULL
        ORDER BY unboxed_at DESC
        LIMIT 10`,
    );
    console.log('Sample (newest 10):');
    for (const row of sample.rows) {
      console.log(`  receiving.id=${row.id} unboxed_at=${row.unboxed_at}`);
    }
    console.log('Dry run — no changes written.');
    await pool.end();
    return;
  }

  const result = await pool.query(
    `UPDATE receiving
        SET unboxed_by = $1,
            updated_at = NOW()
      WHERE unboxed_at IS NOT NULL
        AND unboxed_by IS NULL`,
    [staffId],
  );
  console.log(`Updated ${result.rowCount} row(s).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
