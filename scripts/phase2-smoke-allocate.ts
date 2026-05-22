/**
 * phase2-smoke-allocate.ts
 * ────────────────────────────────────────────────────────────────────
 * Phase 2 smoke test for the allocation pipeline. Invokes the real
 * `allocateOrder()` function (bypassing the INVENTORY_V2_ALLOCATION
 * flag — the function's docstring permits test-harness bypass) and
 * verifies the result lands in:
 *
 *   1. order_unit_allocations (state=ALLOCATED)
 *   2. serial_units.current_status (STOCKED → ALLOCATED)
 *   3. inventory_events (event_type=ALLOCATED, with platform_sku payload)
 *   4. /api/pick/queue equivalent (loadPickQueue)
 *
 * Three modes:
 *   tsx scripts/phase2-smoke-allocate.ts              # dry-run: list candidates
 *   tsx scripts/phase2-smoke-allocate.ts --smoke      # allocate ONE candidate
 *   tsx scripts/phase2-smoke-allocate.ts --apply      # allocate ALL candidates
 *
 * Each allocation is reversible via POST /api/orders/[id]/release if
 * you want to roll back after testing.
 *
 * Run from the repo root so `import '@/...'` resolves.
 */

import pool from '../src/lib/db';
import { allocateOrder } from '../src/lib/inventory/allocate';
import { loadPickQueue } from '../src/lib/picking/queue';

const APPLY = process.argv.includes('--apply');
const SMOKE = process.argv.includes('--smoke');
const DRY = !APPLY && !SMOKE;

function mode() {
  if (APPLY) return 'APPLY-ALL';
  if (SMOKE) return 'SMOKE-ONE';
  return 'DRY-RUN';
}

async function main() {
  console.log(`Mode: ${mode()}\n`);

  // 1. Find allocatable candidates — same query as the verifier.
  const candidates = await pool.query<{
    order_id: number;
    order_label: string | null;
    account_source: string | null;
    platform_sku: string | null;
    canonical_sku: string;
    stocked: number;
  }>(`
    SELECT o.id            AS order_id,
           o.order_id      AS order_label,
           o.account_source,
           o.sku           AS platform_sku,
           sc.sku          AS canonical_sku,
           (SELECT COUNT(*)::int FROM serial_units su WHERE su.sku = sc.sku AND su.current_status = 'STOCKED') AS stocked
      FROM orders o
      JOIN sku_catalog sc ON sc.id = o.sku_catalog_id
     WHERE (o.status IS NULL OR o.status != 'shipped')
       AND o.sku_catalog_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM order_unit_allocations oua
          WHERE oua.order_id = o.id
            AND oua.state IN ('ALLOCATED','PICKING','PICKED','PACKED','SHIPPED')
       )
       AND EXISTS (
         SELECT 1 FROM serial_units su
          WHERE su.sku = sc.sku AND su.current_status = 'STOCKED'
       )
     ORDER BY stocked DESC, o.id ASC
  `);
  console.log(`Allocatable open orders: ${candidates.rows.length}`);
  for (const c of candidates.rows.slice(0, 30)) {
    console.log(
      `  #${String(c.order_id).padEnd(6)}  ${(c.order_label || '-').padEnd(22)}  ` +
      `src=${(c.account_source || '(null)').padEnd(8)}  ${c.platform_sku || '(null)'} → ${c.canonical_sku}  stocked=${c.stocked}`,
    );
  }
  if (candidates.rows.length > 30) console.log(`  ... and ${candidates.rows.length - 30} more`);

  if (DRY) {
    console.log('\nDRY-RUN — no allocations performed.');
    console.log('  --smoke  → allocate first order only');
    console.log('  --apply  → allocate ALL candidates');
    return;
  }

  // 2. Pick the targets.
  const targets = SMOKE ? candidates.rows.slice(0, 1) : candidates.rows;
  console.log(`\nAllocating ${targets.length} order(s)...\n`);

  let okCount = 0;
  let failCount = 0;
  const results: Array<{ orderId: number; status: string; detail: string }> = [];

  for (const t of targets) {
    const clientEventId = `phase2-smoke:order-${t.order_id}:${Date.now()}`;
    const result = await allocateOrder({
      orderId: t.order_id,
      actorStaffId: null,                  // system-initiated
      clientEventId,
    });
    if (result.ok) {
      okCount++;
      results.push({
        orderId: t.order_id,
        status: 'OK',
        detail: `allocated=${result.allocated}/${result.requested} sku=${result.sku} units=[${result.units.map((u) => u.unitId).join(',')}]`,
      });
      console.log(`  ✓ order #${t.order_id}  ${results[results.length - 1].detail}`);
    } else {
      failCount++;
      results.push({
        orderId: t.order_id,
        status: `FAIL ${result.status}`,
        detail: result.error,
      });
      console.log(`  ✗ order #${t.order_id}  status=${result.status}  ${result.error}`);
    }
  }

  console.log(`\nAllocation summary: ok=${okCount}  failed=${failCount}`);

  // 3. Verify side effects on the first successful allocation.
  const firstOk = results.find((r) => r.status === 'OK');
  if (firstOk) {
    console.log(`\nVerification on order #${firstOk.orderId}:`);
    const alloc = await pool.query(
      `SELECT oua.id, oua.state::text AS state, oua.serial_unit_id, su.sku, su.current_status::text AS unit_status, su.current_location
         FROM order_unit_allocations oua
         JOIN serial_units su ON su.id = oua.serial_unit_id
        WHERE oua.order_id = $1`,
      [firstOk.orderId],
    );
    for (const r of alloc.rows) {
      console.log(`  allocation #${r.id} state=${r.state}  unit=#${r.serial_unit_id} sku=${r.sku} status=${r.unit_status} loc=${r.current_location}`);
    }
    const ev = await pool.query(
      `SELECT id, event_type, prev_status, next_status, payload
         FROM inventory_events
        WHERE payload->>'order_id' = $1::text
        ORDER BY id DESC
        LIMIT 5`,
      [String(firstOk.orderId)],
    );
    console.log(`  inventory_events emitted (${ev.rowCount}):`);
    for (const r of ev.rows) {
      console.log(`    #${r.id} type=${r.event_type} ${r.prev_status}→${r.next_status} payload=${JSON.stringify(r.payload).slice(0, 200)}`);
    }
  }

  // 4. Verify the queue endpoint surfaces the new allocation(s).
  console.log(`\nPicker queue snapshot (loadPickQueue):`);
  const queue = await loadPickQueue();
  console.log(`  ${queue.length} order(s) in queue`);
  for (const q of queue.slice(0, 10)) {
    console.log(`    #${q.orderId}  ${q.orderLabel}  ${q.customerName ?? '-'}  total=${q.totalCount}  pending=${q.pendingCount}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
  });
