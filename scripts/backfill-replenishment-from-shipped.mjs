/**
 * Backfill replenishment requests from recently shipped orders.
 *
 * Usage:
 *   node scripts/backfill-replenishment-from-shipped.mjs [--days 30] [--dry-run]
 *
 * Scans orders that were packed (have a PACK_COMPLETED station_activity_log)
 * in the last N days and ensures a replenishment request exists for each.
 */

import pg from 'pg';
import { config } from 'dotenv';

config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const args = process.argv.slice(2);
const daysBack = Number(args.find((_, i, a) => a[i - 1] === '--days') || '30');
const dryRun = args.includes('--dry-run');

async function main() {
  console.log(`Backfilling replenishment from shipped orders (last ${daysBack} days)${dryRun ? ' [DRY RUN]' : ''}...`);

  // Find shipped order IDs from station_activity_logs PACK_COMPLETED
  const result = await pool.query(
    `SELECT DISTINCT o.id AS order_id, o.sku, o.product_title
     FROM orders o
     WHERE o.shipment_id IS NOT NULL
       AND o.sku IS NOT NULL
       AND BTRIM(o.sku) <> ''
       AND EXISTS (
         SELECT 1 FROM station_activity_logs s
         WHERE s.station = 'PACK'
           AND s.activity_type = 'PACK_COMPLETED'
           AND s.shipment_id = o.shipment_id
           AND s.created_at >= NOW() - make_interval(days => $1)
       )
       AND NOT EXISTS (
         SELECT 1 FROM replenishment_order_lines rol
         WHERE rol.order_id = o.id
       )
     ORDER BY o.id ASC`,
    [daysBack]
  );

  console.log(`Found ${result.rows.length} shipped orders without replenishment requests.`);

  if (dryRun) {
    for (const row of result.rows) {
      console.log(`  [dry-run] Order #${row.order_id}: ${row.sku} — ${(row.product_title || '').substring(0, 60)}`);
    }
    console.log('Dry run complete. No changes made.');
    await pool.end();
    return;
  }

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of result.rows) {
    try {
      // Check if item exists in Zoho items table
      const itemCheck = await pool.query(
        `SELECT id, zoho_item_id FROM items WHERE sku = $1 AND status = 'active' LIMIT 1`,
        [row.sku]
      );

      if (!itemCheck.rows[0]) {
        skipped++;
        continue;
      }

      const item = itemCheck.rows[0];

      // Check for existing active request for this item
      const existingCheck = await pool.query(
        `SELECT id FROM replenishment_requests
         WHERE zoho_item_id = $1
           AND status NOT IN ('fulfilled', 'cancelled')
         LIMIT 1`,
        [item.zoho_item_id]
      );

      let requestId;

      if (existingCheck.rows[0]) {
        requestId = existingCheck.rows[0].id;
      } else {
        // Create new request
        const insertResult = await pool.query(
          `INSERT INTO replenishment_requests (
             item_id, zoho_item_id, sku, item_name, quantity_needed, status, notes
           ) VALUES ($1, $2, $3, $4, 1, 'detected', 'Backfilled from shipped orders')
           RETURNING id`,
          [item.id, item.zoho_item_id, row.sku, row.product_title || 'Unknown']
        );
        requestId = insertResult.rows[0].id;
      }

      // Link the order
      await pool.query(
        `INSERT INTO replenishment_order_lines (
           replenishment_request_id, order_id, channel_order_id, quantity_needed
         ) VALUES ($1, $2, NULL, 1)
         ON CONFLICT (replenishment_request_id, order_id) DO NOTHING`,
        [requestId, row.order_id]
      );

      // Recompute quantity
      await pool.query(
        `UPDATE replenishment_requests rr
         SET quantity_needed = COALESCE((
               SELECT SUM(rol.quantity_needed)
               FROM replenishment_order_lines rol
               WHERE rol.replenishment_request_id = rr.id
             ), 0),
             updated_at = NOW()
         WHERE rr.id = $1`,
        [requestId]
      );

      created++;
      if (created % 50 === 0) console.log(`  ... processed ${created} orders`);
    } catch (err) {
      errors++;
      console.error(`  Error processing order #${row.order_id}:`, err.message);
    }
  }

  console.log(`\nDone. Created/linked: ${created}, Skipped (no Zoho item): ${skipped}, Errors: ${errors}`);
  await pool.end();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  pool.end();
  process.exit(1);
});
