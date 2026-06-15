#!/usr/bin/env node
/**
 * Backfill tracking-scan operator attribution:
 *   - receiving_scans.scanned_by
 *   - receiving.received_by (door-scan fallback when no scans row)
 *
 * Usage:
 *   node scripts/backfill-tracking-scanned-by.mjs --staff-id 1 --dry-run
 *   node scripts/backfill-tracking-scanned-by.mjs --staff-id 1
 */
import 'dotenv/config';
import pg from 'pg';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const staffArg = argv.indexOf('--staff-id');
const staffId = staffArg >= 0 ? Number(argv[staffArg + 1]) : 1;

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

  const hasScans = await pool.query(`SELECT to_regclass('public.receiving_scans') AS t`);
  const scansTable = Boolean(hasScans.rows[0]?.t);

  let scansNull = 0;
  if (scansTable) {
    const c = await pool.query(
      `SELECT COUNT(*)::int AS n FROM receiving_scans WHERE scanned_by IS NULL`,
    );
    scansNull = c.rows[0]?.n ?? 0;
    console.log(`receiving_scans.scanned_by NULL: ${scansNull}`);
  } else {
    console.log('receiving_scans table not found — skipping scan rows');
  }

  const recvC = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM receiving
      WHERE received_at IS NOT NULL
        AND received_by IS NULL`,
  );
  const receivedNull = recvC.rows[0]?.n ?? 0;
  console.log(`receiving.received_by NULL (received_at set): ${receivedNull}`);

  if (scansNull === 0 && receivedNull === 0) {
    console.log('Nothing to backfill.');
    await pool.end();
    return;
  }

  if (dryRun) {
    if (scansTable && scansNull > 0) {
      const sample = await pool.query(
        `SELECT id, receiving_id, tracking_number,
                to_char(scanned_at::timestamp, 'YYYY-MM-DD HH24:MI:SS') AS scanned_at
           FROM receiving_scans
          WHERE scanned_by IS NULL
          ORDER BY scanned_at DESC NULLS LAST
          LIMIT 10`,
      );
      console.log('Sample receiving_scans (newest 10):');
      for (const row of sample.rows) {
        console.log(`  scan.id=${row.id} receiving_id=${row.receiving_id} ${row.tracking_number} @ ${row.scanned_at}`);
      }
    }
    console.log('Dry run — no changes written.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let scansUpdated = 0;
    if (scansTable && scansNull > 0) {
      const res = await client.query(
        `UPDATE receiving_scans SET scanned_by = $1 WHERE scanned_by IS NULL`,
        [staffId],
      );
      scansUpdated = res.rowCount ?? 0;
    }
    let recvUpdated = 0;
    if (receivedNull > 0) {
      const res = await client.query(
        `UPDATE receiving
            SET received_by = $1,
                updated_at = NOW()
          WHERE received_at IS NOT NULL
            AND received_by IS NULL`,
        [staffId],
      );
      recvUpdated = res.rowCount ?? 0;
    }
    await client.query('COMMIT');
    console.log(`Updated receiving_scans.scanned_by: ${scansUpdated}`);
    console.log(`Updated receiving.received_by: ${recvUpdated}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
