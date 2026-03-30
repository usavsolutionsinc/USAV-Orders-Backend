#!/usr/bin/env node
/**
 * backfill-packer-shipment-ids.mjs
 * ────────────────────────────────────────────────────────────────────
 * One-time migration: find packer_logs and station_activity_logs rows
 * with NULL shipment_id that can now be matched to a shipping_tracking_numbers
 * row via key18 suffix match, and backfill the FK.
 *
 * Also sets orders.status = 'shipped' for newly linked orders.
 *
 * Usage:  node scripts/backfill-packer-shipment-ids.mjs [--dry-run]
 * ────────────────────────────────────────────────────────────────────
 */
import 'dotenv/config';
import pg from 'pg';

const dryRun = process.argv.includes('--dry-run');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  console.log(dryRun ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  // Find orphaned packer_logs that can be matched via key18
  const orphans = await pool.query(`
    SELECT
      pl.id AS packer_log_id,
      pl.scan_ref,
      s.id AS matched_stn_id,
      o.id AS matched_order_id
    FROM packer_logs pl
    CROSS JOIN LATERAL (
      SELECT s.id
      FROM shipping_tracking_numbers s
      WHERE RIGHT(regexp_replace(UPPER(s.tracking_number_normalized), '[^A-Z0-9]', '', 'g'), 18)
          = RIGHT(regexp_replace(UPPER(pl.scan_ref), '[^A-Z0-9]', '', 'g'), 18)
      LIMIT 1
    ) s
    LEFT JOIN orders o ON o.shipment_id = s.id
    WHERE pl.shipment_id IS NULL
      AND pl.tracking_type = 'ORDERS'
      AND pl.scan_ref IS NOT NULL
      AND LENGTH(pl.scan_ref) >= 18
  `);

  console.log(`Found ${orphans.rows.length} orphaned packer_logs with key18 matches\n`);

  let updated = 0;
  for (const row of orphans.rows) {
    console.log(
      `packer_log=${row.packer_log_id} scan=${row.scan_ref} → stn=${row.matched_stn_id} order=${row.matched_order_id}`
    );

    if (dryRun) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Update packer_logs.shipment_id
      await client.query(
        'UPDATE packer_logs SET shipment_id = $1, updated_at = NOW() WHERE id = $2',
        [row.matched_stn_id, row.packer_log_id]
      );

      // 2. Update matching station_activity_logs row (same scan_ref, NULL shipment_id)
      await client.query(`
        UPDATE station_activity_logs
        SET shipment_id = $1
        WHERE shipment_id IS NULL
          AND scan_ref = $2
          AND station = 'PACK'
          AND activity_type IN ('PACK_COMPLETED', 'PACK_SCAN')
      `, [row.matched_stn_id, row.scan_ref]);

      // 3. Mark order as shipped if we found one
      if (row.matched_order_id) {
        await client.query(`
          UPDATE orders SET status = 'shipped'
          WHERE id = $1 AND (status IS NULL OR status != 'shipped')
        `, [row.matched_order_id]);
      }

      await client.query('COMMIT');
      updated++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ERROR on packer_log=${row.packer_log_id}:`, err.message);
    } finally {
      client.release();
    }
  }

  console.log(`\nDone. Updated ${updated} / ${orphans.rows.length} rows.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
