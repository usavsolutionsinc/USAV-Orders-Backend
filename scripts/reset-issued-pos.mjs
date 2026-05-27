#!/usr/bin/env node
/**
 * One-off cleanup before the new May-8-forward Zoho PO import policy.
 *
 *   1. DELETE every EXPECTED, untouched receiving_lines row that came from
 *      a Zoho PO sync. Touched rows (quantity_received > 0) stay so we
 *      don't blow away an in-flight receive.
 *   2. DELETE every `receiving` row with source='zoho_po' that no longer
 *      has any receiving_lines pointing at it. Cascade-deletes clean up
 *      receiving_scans + photos automatically (see migrations 2026-04-14
 *      and 2026-03-05). serial_units / inventory_events / tech_serial_numbers
 *      reference receiving_lines.id with ON DELETE SET NULL, so audit
 *      lineage is preserved even when the line is gone.
 *   3. Pin `sync_cursors.zoho_purchase_orders` to 2026-05-08T00:00:00Z so
 *      the next incoming-po-sync cron only pulls deltas modified since then.
 *
 * Usage:
 *   node scripts/reset-issued-pos.mjs           # dry run (reports counts)
 *   node scripts/reset-issued-pos.mjs --apply   # actually delete
 */

import { Pool } from 'pg';

try {
  const { config } = await import('dotenv');
  config({ path: '.env.local' });
  config({ path: '.env' });
} catch {
  // dotenv optional
}

const APPLY = process.argv.includes('--apply');
const CURSOR_AT = '2026-05-08T00:00:00Z';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(2);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  console.log(APPLY ? 'APPLY mode — writing changes.' : 'DRY RUN — pass --apply to commit.');

  // ── Preview counts ────────────────────────────────────────────────────────
  const linesPreview = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM receiving_lines
      WHERE workflow_status = 'EXPECTED'
        AND COALESCE(quantity_received, 0) = 0
        AND zoho_purchaseorder_id IS NOT NULL`,
  );
  const linesToDelete = linesPreview.rows[0].count;
  console.log(`receiving_lines (issued + untouched): ${linesToDelete}`);

  const recvPreview = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM receiving r
      WHERE r.source = 'zoho_po'
        AND NOT EXISTS (
          SELECT 1 FROM receiving_lines rl
           WHERE rl.receiving_id = r.id
             AND (rl.workflow_status <> 'EXPECTED' OR COALESCE(rl.quantity_received, 0) > 0)
        )`,
  );
  const recvToDelete = recvPreview.rows[0].count;
  console.log(`receiving rows (zoho_po, untouched after lines deleted): ${recvToDelete}`);

  const cursorBefore = await pool.query(
    `SELECT last_synced_at FROM sync_cursors WHERE resource = 'zoho_purchase_orders'`,
  );
  console.log(
    `sync_cursors.zoho_purchase_orders: ${
      cursorBefore.rows[0]?.last_synced_at ?? '(none)'
    } → ${CURSOR_AT}`,
  );

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to delete.');
    await pool.end();
    return;
  }

  // ── Apply ─────────────────────────────────────────────────────────────────
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Delete untouched EXPECTED receiving_lines.
    const delLines = await client.query(
      `DELETE FROM receiving_lines
        WHERE workflow_status = 'EXPECTED'
          AND COALESCE(quantity_received, 0) = 0
          AND zoho_purchaseorder_id IS NOT NULL`,
    );
    console.log(`  deleted receiving_lines: ${delLines.rowCount}`);

    // 2. Delete orphaned zoho_po receiving rows (no remaining lines).
    const delRecv = await client.query(
      `DELETE FROM receiving r
        WHERE r.source = 'zoho_po'
          AND NOT EXISTS (
            SELECT 1 FROM receiving_lines rl WHERE rl.receiving_id = r.id
          )`,
    );
    console.log(`  deleted receiving (zoho_po, orphan): ${delRecv.rowCount}`);

    // 3. Pin the sync cursor so the next delta pull only sees POs modified
    //    on or after 2026-05-08. `getSyncCursor` reads `last_synced_at` and
    //    formats it as the Zoho-friendly cursor.
    const upd = await client.query(
      `INSERT INTO sync_cursors (resource, last_synced_at, updated_at)
       VALUES ('zoho_purchase_orders', $1::timestamptz, NOW())
       ON CONFLICT (resource) DO UPDATE
         SET last_synced_at = EXCLUDED.last_synced_at,
             updated_at     = NOW()`,
      [CURSOR_AT],
    );
    console.log(`  cursor upsert: ${upd.rowCount}`);

    await client.query('COMMIT');
    console.log('\nDone.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await pool.end();
}

main().catch((err) => {
  console.error('reset-issued-pos failed:', err);
  process.exit(1);
});
