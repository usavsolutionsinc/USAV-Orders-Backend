/**
 * E2E: shipped-search packer-scan gate.
 *
 * Verifies the fix in ORDER_SERIALS_CTE_ALL (src/lib/neon/orders-queries.ts):
 * a tracking number that has never been scanned out by a packer must NOT appear
 * in shipped search results — even though an order/shipment may be assigned to it.
 *
 * This exercises the exact function the GET /api/shipped route calls
 * (`searchShippedOrders`), so it validates the route logic end-to-end against
 * the live DB (minus the HTTP auth wrapper).
 *
 * Usage: npx tsx scripts/e2e-shipped-search-packer-gate.ts [tracking]
 */
import assert from 'node:assert/strict';
import pool from '@/lib/db';
import { searchShippedOrders } from '@/lib/neon/orders-queries';

const TRACKING = process.argv[2] || '9400150206217693911879';

function norm(t: string): string {
  return t.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

async function main() {
  console.log(`\n=== E2E shipped-search packer gate ===`);
  console.log(`Tracking under test: ${TRACKING}\n`);

  // 1) Locate the shipment/order(s) this tracking belongs to + derive org + facts.
  const factsRes = await pool.query(
    `SELECT
       o.id              AS order_row_id,
       o.order_id        AS order_id,
       o.organization_id AS organization_id,
       o.shipment_id     AS shipment_id,
       COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
         OR stn.is_out_for_delivery OR stn.is_delivered, false) AS is_shipped,
       EXISTS (
         SELECT 1 FROM packer_logs pl
         WHERE pl.shipment_id = o.shipment_id
           AND pl.tracking_type = 'ORDERS'
       ) AS has_orders_packer_log,
       EXISTS (
         SELECT 1 FROM station_activity_logs sal
         WHERE sal.station = 'PACK'
           AND sal.shipment_id = o.shipment_id
           AND sal.activity_type IN ('PACK_COMPLETED','PACK_SCAN')
       ) AS has_pack_scan
     FROM shipping_tracking_numbers stn
     JOIN orders o ON o.shipment_id = stn.id
     WHERE RIGHT(regexp_replace(UPPER(COALESCE(stn.tracking_number_normalized, stn.tracking_number_raw, '')), '[^A-Z0-9]', '', 'g'), 18)
           = RIGHT($1, 18)
        OR stn.tracking_number_raw = $2`,
    [norm(TRACKING), TRACKING],
  );

  if (factsRes.rows.length === 0) {
    console.log('No order/shipment is associated with this tracking number at all.');
    console.log('→ It can never appear in shipped search. (trivially passes)\n');
  } else {
    for (const r of factsRes.rows) {
      console.log('Associated order found:');
      console.log(`  order_id            : ${r.order_id}`);
      console.log(`  shipment_id         : ${r.shipment_id}`);
      console.log(`  is_shipped (carrier): ${r.is_shipped}`);
      console.log(`  has ORDERS packer log: ${r.has_orders_packer_log}`);
      console.log(`  has PACK-station scan: ${r.has_pack_scan}`);
      const wouldHaveShownBefore = true; // old ungated CTE surfaced any assigned shipment
      const packerScanned = r.has_orders_packer_log || r.has_pack_scan;
      console.log(`  → packer scanned out : ${packerScanned}`);
      console.log(`  → pre-fix would show : ${wouldHaveShownBefore}`);
      console.log(`  → post-fix should show: ${packerScanned}\n`);
    }
  }

  const organizationId =
    factsRes.rows[0]?.organization_id ||
    (await pool.query(`SELECT organization_id FROM orders WHERE organization_id IS NOT NULL LIMIT 1`)).rows[0]?.organization_id;

  if (!organizationId) {
    throw new Error('Could not resolve an organizationId to run the search with.');
  }
  console.log(`Running searchShippedOrders with organizationId=${organizationId}\n`);

  // 2) Run the ACTUAL route function across the relevant search fields.
  const fields = ['all', 'tracking'] as const;
  let anyMatch = false;
  for (const searchField of fields) {
    const result = await searchShippedOrders(TRACKING, {
      organizationId,
      searchField,
      shippedFilter: 'all',
    });
    const matches = result.rows.filter((row) => {
      const candidates = [
        row.shipping_tracking_number,
        ...(Array.isArray(row.tracking_numbers) ? row.tracking_numbers : []),
        ...(((row as any).tracking_number_rows as Array<{ tracking?: string }> | undefined) || []).map((t) => t?.tracking),
      ].filter(Boolean) as string[];
      return candidates.some((c) => norm(c).endsWith(norm(TRACKING).slice(-18)) || norm(c) === norm(TRACKING));
    });
    console.log(`searchField='${searchField}': ${result.rows.length} total rows, ${matches.length} matching this tracking`);
    if (matches.length) {
      anyMatch = true;
      for (const m of matches) {
        console.log(`   ✗ LEAKED: order_id=${m.order_id} packed_by=${m.packed_by} packed_at=${m.packed_at} pack_activity_at=${(m as any).pack_activity_at}`);
      }
    }
  }

  console.log('');
  assert.equal(
    anyMatch,
    false,
    `FAIL: tracking ${TRACKING} appeared in shipped search results despite never being packer-scanned.`,
  );
  console.log(`✓ PASS: tracking ${TRACKING} returns NO shipped-search result (never packer-scanned).\n`);
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('\n✗ E2E FAILED:', err.message);
    try { await pool.end(); } catch { /* ignore */ }
    process.exit(1);
  });
