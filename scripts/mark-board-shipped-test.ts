/**
 * mark-board-shipped-test.ts
 * ───────────────────────────────────────────────────────────────────
 * TEST-DISPLAY CURATION (reversible).
 *
 * Marks every order currently on the Dashboard · Unshipped board (labeled,
 * not-packed, not carrier-shipped) as SHIPPED — EXCEPT a small keep-list of
 * tracking numbers — so the board/Tested display shows only those few rows.
 *
 * "Shipped" here = the STN is set to a terminal DELIVERED carrier state, which
 *   (a) removes it from the Unshipped board (SHIPPED_BY_CARRIER_SQL is true), and
 *   (b) is_terminal=true so the tracking-sync cron stops polling it and does NOT
 *       revert it to its real pre-ship status.
 *
 * Reversible: before writing, the prior STN state of every touched row is
 * snapshotted to scripts/.shipped-test-snapshot.json. Re-run with `--revert` to
 * restore exactly.
 *
 * Apply:  node --env-file=.env --import tsx scripts/mark-board-shipped-test.ts
 * Revert: node --env-file=.env --import tsx scripts/mark-board-shipped-test.ts --revert
 * ───────────────────────────────────────────────────────────────────
 */
import { Pool } from 'pg';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }
const pool = new Pool({ connectionString: DATABASE_URL });

const REVERT = process.argv.includes('--revert');
const SNAPSHOT_PATH = join(process.cwd(), 'scripts', '.shipped-test-snapshot.json');

/** Tracking numbers that must STAY on the board (the only rows left in Tested). */
const KEEP_TRACKING = [
  '9434608106245294426458',
  '1Z1A375J4231045854',
  '9400100000000000000099',
];

/** STN columns we snapshot + mutate (so revert is exact). */
const SNAP_COLS = [
  'latest_status_category',
  'is_carrier_accepted',
  'is_in_transit',
  'is_out_for_delivery',
  'is_delivered',
  'has_exception',
  'is_terminal',
  'latest_event_at',
  'next_check_at',
] as const;

async function apply() {
  const client = await pool.connect();
  try {
    // The current Unshipped board: labeled, not packed, not already carrier-shipped,
    // not Amazon-fulfilled — minus the keep-list trackings.
    const targets = await client.query(
      `SELECT DISTINCT stn.id AS shipment_id, ${SNAP_COLS.map((c) => `stn.${c}`).join(', ')}
         FROM orders o
         JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
        WHERE o.shipment_id IS NOT NULL
          AND COALESCE(o.fulfillment_channel,'') <> 'AFN'
          AND stn.tracking_number_raw <> ALL($1::text[])
          AND NOT (
            COALESCE(stn.is_carrier_accepted OR stn.is_in_transit OR stn.is_out_for_delivery OR stn.is_delivered
              OR (COALESCE(BTRIM(stn.latest_status_category),'') <> ''
                  AND UPPER(BTRIM(stn.latest_status_category)) NOT IN ('LABEL_CREATED','UNKNOWN')), false)
          )
          AND NOT EXISTS (
            SELECT 1 FROM station_activity_logs sal
            WHERE sal.shipment_id = o.shipment_id
              AND sal.activity_type IN ('PACK_COMPLETED','PACK_SCAN')
          )`,
      [KEEP_TRACKING],
    );

    const ids = targets.rows.map((r: any) => Number(r.shipment_id));
    if (!ids.length) { console.log('Nothing to mark — board already curated.'); return; }

    // Snapshot BEFORE mutating, so --revert restores the exact prior state.
    writeFileSync(SNAPSHOT_PATH, JSON.stringify({ at: 'apply', rows: targets.rows }, null, 2));
    console.log(`📸 snapshot written: ${SNAPSHOT_PATH} (${targets.rows.length} shipments)`);

    const res = await client.query(
      `UPDATE shipping_tracking_numbers
          SET latest_status_category = 'DELIVERED',
              is_delivered = true,
              is_carrier_accepted = true,
              is_in_transit = false,
              is_out_for_delivery = false,
              has_exception = false,
              is_terminal = true,
              latest_event_at = NOW(),
              next_check_at = NULL,
              updated_at = NOW()
        WHERE id = ANY($1::bigint[])`,
      [ids],
    );
    console.log(`✅ marked ${res.rowCount} shipment(s) DELIVERED (off the board). Kept trackings: ${KEEP_TRACKING.join(', ')}`);
  } finally {
    client.release();
  }
}

async function revert() {
  if (!existsSync(SNAPSHOT_PATH)) { console.error(`No snapshot at ${SNAPSHOT_PATH}; nothing to revert.`); process.exit(1); }
  const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as { rows: any[] };
  const client = await pool.connect();
  try {
    let n = 0;
    for (const row of snap.rows) {
      await client.query(
        `UPDATE shipping_tracking_numbers
            SET ${SNAP_COLS.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = NOW()
          WHERE id = $1`,
        [Number(row.shipment_id), ...SNAP_COLS.map((c) => row[c])],
      );
      n += 1;
    }
    console.log(`↩️  reverted ${n} shipment(s) to their snapshotted state.`);
  } finally {
    client.release();
  }
}

(REVERT ? revert() : apply())
  .then(() => pool.end())
  .catch((e) => { console.error('❌', e); pool.end(); process.exit(1); });
