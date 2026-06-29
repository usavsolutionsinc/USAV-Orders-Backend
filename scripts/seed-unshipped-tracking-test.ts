/**
 * seed-unshipped-tracking-test.ts
 * ───────────────────────────────────────────────────────────────────
 * Seeds two clearly-labeled TEST orders into the live DB so the
 * dashboard "Unshipped" view's tracking flow can be exercised end-to-end:
 *
 *   TEST-UNSHIP-AWAIT    → shipment_id NULL  (AWAITING stage; no tracking)
 *                          Use this to test the Add-TRK# write flow from the UI.
 *   TEST-UNSHIP-PENDING  → tracking assigned via the REAL upsertOrderTracking
 *                          path (PENDING stage; shows the test tracking number).
 *
 * Idempotent: deletes any prior rows with these order_ids (and their STN /
 * links) before recreating. Pass `--clean` to only remove them.
 *
 * Run:  node --env-file=.env --import tsx scripts/seed-unshipped-tracking-test.ts
 * Clean: node --env-file=.env --import tsx scripts/seed-unshipped-tracking-test.ts --clean
 * ───────────────────────────────────────────────────────────────────
 */
import { Pool } from 'pg';
import { upsertOrderTracking } from '@/lib/neon/orders-tracking-queries';
import { detectCarrier, normalizeTrackingNumber } from '@/lib/shipping/normalize';
import { transitionalUsavOrgId } from '@/lib/tenancy/db';

const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }
const pool = new Pool({ connectionString: DATABASE_URL });

const ORG_ID = transitionalUsavOrgId();
const CLEAN_ONLY = process.argv.includes('--clean');

const AWAIT_ORDER_ID = 'TEST-UNSHIP-AWAIT';
const PENDING_ORDER_ID = 'TEST-UNSHIP-PENDING';
// USPS-format 22-digit test tracking. Verified live by detectCarrier below.
const TEST_TRACKING = '9400100000000000000099';

/** Set the tenant GUC so NOT-NULL organization_id defaults auto-stamp. */
async function setOrg(client: { query: (q: string, p?: any[]) => Promise<any> }) {
  await client.query(`SELECT set_config('app.current_org', $1, true)`, [ORG_ID]);
}

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setOrg(client);
    // Find the test orders + the shipments they (solely) own.
    const orders = await client.query(
      `SELECT id, shipment_id FROM orders WHERE order_id = ANY($1::text[])`,
      [[AWAIT_ORDER_ID, PENDING_ORDER_ID]],
    );
    const orderIds = orders.rows.map((r: any) => Number(r.id));
    const shipmentIds = orders.rows
      .map((r: any) => Number(r.shipment_id))
      .filter((s: number) => Number.isFinite(s) && s > 0);

    // The STN (shipping_tracking_numbers) row is the single SoT for the test
    // tracking and is REUSED across runs — `upsertOrderTracking` re-finds it by
    // normalized tracking number. We never delete it (it is FK-referenced by
    // station_scan_sessions / station_activity_logs / etc.); instead we detach
    // the test orders, clear any station logs that would mask it as "packed",
    // and reset its carrier-status flags back to unshipped.
    const norm = normalizeTrackingNumber(TEST_TRACKING);
    const stnRow = await client.query(
      `SELECT id FROM shipping_tracking_numbers WHERE tracking_number_normalized = $1`,
      [norm],
    );
    const stnIds = Array.from(
      new Set([...shipmentIds, ...stnRow.rows.map((r: any) => Number(r.id))]),
    ).filter((s) => Number.isFinite(s) && s > 0);

    if (orderIds.length) {
      await client.query(
        `DELETE FROM shipment_links WHERE owner_type = 'ORDER' AND owner_id = ANY($1::int[])`,
        [orderIds],
      );
      await client.query(`UPDATE orders SET shipment_id = NULL WHERE id = ANY($1::int[])`, [orderIds]);
      await client.query(`DELETE FROM orders WHERE id = ANY($1::int[])`, [orderIds]);
    }

    if (stnIds.length) {
      // Clear station scans/activity so the reused STN reads as unpacked, and
      // reset carrier-status flags so it reads as unshipped (PENDING, not shipped).
      await client.query(`DELETE FROM station_scan_sessions WHERE shipment_id = ANY($1::bigint[])`, [stnIds]);
      await client.query(`DELETE FROM station_activity_logs WHERE shipment_id = ANY($1::bigint[])`, [stnIds]);
      await client.query(
        `UPDATE shipping_tracking_numbers
            SET is_carrier_accepted = false, is_in_transit = false,
                is_out_for_delivery = false, is_delivered = false,
                latest_status_category = NULL
          WHERE id = ANY($1::bigint[])`,
        [stnIds],
      );
    }
    await client.query('COMMIT');
    console.log(`🧹 cleaned ${orderIds.length} test order(s); reused STN id(s) [${stnIds.join(', ')}]`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function createOrder(client: any, orderId: string, title: string): Promise<number> {
  const r = await client.query(
    `INSERT INTO orders (order_id, product_title, sku, status, quantity, account_source, order_date, created_at, condition)
     VALUES ($1, $2, $3, 'unassigned', '1', 'TEST', NOW(), NOW(), 'New')
     RETURNING id`,
    [orderId, title, 'TEST-SKU'],
  );
  return Number(r.rows[0].id);
}

async function seed() {
  // Carrier sanity check before we write anything.
  const norm = normalizeTrackingNumber(TEST_TRACKING);
  const carrier = detectCarrier(norm);
  console.log(`tracking ${TEST_TRACKING} → normalized=${norm} carrier=${carrier ?? 'UNKNOWN(manual)'}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setOrg(client);

    const awaitId = await createOrder(client, AWAIT_ORDER_ID, 'TEST — Unshipped AWAITING (add tracking here)');
    const pendingId = await createOrder(client, PENDING_ORDER_ID, 'TEST — Unshipped PENDING (tracking assigned)');

    // The STN row for this test tracking is the SoT and is reused across runs.
    // If it already exists (kept by cleanup), pre-point the PENDING order at it
    // so upsertOrderTracking takes its "already owned → re-point" branch instead
    // of rejecting it as belonging to another shipment.
    const existingStn = await client.query(
      `SELECT id FROM shipping_tracking_numbers WHERE tracking_number_normalized = $1 LIMIT 1`,
      [norm],
    );
    if ((existingStn.rowCount ?? 0) > 0) {
      await client.query(`UPDATE orders SET shipment_id = $1 WHERE id = $2`, [
        Number(existingStn.rows[0].id),
        pendingId,
      ]);
    }

    // Real write path: STN upsert + orders.shipment_id + shipment_links.
    await upsertOrderTracking([pendingId], TEST_TRACKING, client, ORG_ID);

    await client.query('COMMIT');
    console.log(`✅ seeded AWAIT order id=${awaitId} (${AWAIT_ORDER_ID}); PENDING order id=${pendingId} (${PENDING_ORDER_ID})`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // Verify both rows survive the real Unshipped (excludePacked) filter.
  const verify = await pool.query(
    `SELECT o.id, o.order_id, o.shipment_id, stn.tracking_number_raw, stn.carrier,
            stn.latest_status_category,
            (COALESCE(
               stn.is_carrier_accepted OR stn.is_in_transit OR stn.is_out_for_delivery OR stn.is_delivered
               OR (COALESCE(BTRIM(stn.latest_status_category),'') <> ''
                   AND UPPER(BTRIM(stn.latest_status_category)) NOT IN ('LABEL_CREATED','UNKNOWN')),
               false)) AS is_shipped,
            EXISTS (SELECT 1 FROM station_activity_logs sal WHERE sal.shipment_id = o.shipment_id) AS is_packed
       FROM orders o
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
      WHERE o.order_id = ANY($1::text[])
      ORDER BY o.order_id`,
    [[AWAIT_ORDER_ID, PENDING_ORDER_ID]],
  );
  console.log('\n=== verification (must be is_shipped=false, is_packed=false to show in Unshipped) ===');
  for (const r of verify.rows) {
    const stage = r.shipment_id ? 'PENDING' : 'AWAITING';
    console.log(`  [${stage}] ${JSON.stringify(r)}`);
  }
}

(async () => {
  await cleanup();
  if (!CLEAN_ONLY) await seed();
})().then(() => pool.end()).catch((e) => { console.error('❌', e); pool.end(); process.exit(1); });
