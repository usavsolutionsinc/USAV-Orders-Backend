/**
 * reconcile-packer-logs.mjs
 * ────────────────────────────────────────────────────────────────────
 * Phase 3 deliverable #1 — packer_logs ↔ order_unit_allocations
 * reconciliation report. Classifies every order with cross-system
 * activity into one of seven categories so we can see drift before /
 * during / after the picker flag flip.
 *
 * Read-only. Run on a schedule (or on demand) to monitor cutover safety.
 *
 * Categories:
 *
 *   HEALTHY_LEGACY_ONLY
 *     Order shipped through packer_logs, no allocations exist.
 *     Expected for every pre-picker order. No action.
 *
 *   HEALTHY_SYNCED
 *     Both systems agree: packer_logs present AND every allocation is
 *     SHIPPED. The target steady state after cutover.
 *
 *   OPEN_NEW_FLOW
 *     Allocations exist (ALLOCATED / PICKING / PICKED / PACKED), no
 *     packer_logs yet. Order is actively in the picker workflow.
 *     No action — packer will write packer_logs on ship.
 *
 *   DRIFT_ORPHAN_ALLOCATION
 *     Allocations exist for an order whose legacy ship already happened.
 *     Stock was reserved against an order that doesn't need it. Caller
 *     should release the allocation (POST /api/orders/:id/release).
 *
 *   DRIFT_STALE_ALLOCATION
 *     Allocations exist (NOT SHIPPED) AND a packer_logs row was written
 *     AFTER allocation_at. New-system fell behind — picker didn't
 *     complete state transition before packer scanned.
 *
 *   DRIFT_MISSING_LEGACY
 *     Allocations all SHIPPED, no packer_logs row. The /api/pack/ship
 *     dual-write didn't land. Investigate the pack flow.
 *
 *   DRIFT_PARTIAL_SHIP
 *     Some allocations SHIPPED, others NOT, with a packer_logs row.
 *     Multi-line order where part shipped via new flow and part is
 *     stuck. Manual review.
 *
 * Usage:
 *   node scripts/reconcile-packer-logs.mjs                # last 30 days
 *   node scripts/reconcile-packer-logs.mjs --days 90      # custom window
 *   node scripts/reconcile-packer-logs.mjs --all          # full history
 *   node scripts/reconcile-packer-logs.mjs --verbose      # show samples per category
 */

import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const envText = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env', 'utf8');
const url = (envText.match(/^DATABASE_URL_UNPOOLED=(.+)$/m) || envText.match(/^DATABASE_URL=(.+)$/m))[1].trim();
const sql = neon(url);

const args = new Set(process.argv.slice(2));
const VERBOSE = args.has('--verbose');
const ALL = args.has('--all');
const daysArg = process.argv.find((a, i) => process.argv[i - 1] === '--days');
const DAYS = ALL ? null : (daysArg ? Number(daysArg) : 30);

console.log(`Reconciliation window: ${ALL ? 'ALL TIME' : `last ${DAYS} days`}\n`);

// ── Build the per-order classification.
// One row per order_id that has activity in either system within the window.
const since = ALL ? null : new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

const rows = await sql`
  WITH order_activity AS (
    SELECT
      o.id AS order_id,
      o.order_id AS order_label,
      o.status AS order_status,
      o.shipment_id,
      o.account_source,
      (SELECT MIN(pl.created_at) FROM packer_logs pl WHERE pl.shipment_id = o.shipment_id) AS first_packed_at,
      (SELECT MAX(pl.created_at) FROM packer_logs pl WHERE pl.shipment_id = o.shipment_id) AS last_packed_at,
      (SELECT COUNT(*)::int FROM packer_logs pl WHERE pl.shipment_id = o.shipment_id) AS packer_log_count,
      (SELECT COUNT(*)::int FROM order_unit_allocations oua WHERE oua.order_id = o.id) AS alloc_total,
      (SELECT COUNT(*)::int FROM order_unit_allocations oua WHERE oua.order_id = o.id AND oua.state = 'SHIPPED') AS alloc_shipped,
      (SELECT COUNT(*)::int FROM order_unit_allocations oua WHERE oua.order_id = o.id AND oua.state IN ('ALLOCATED','PICKING','PICKED','PACKED','LABELED','STAGED')) AS alloc_open,
      (SELECT COUNT(*)::int FROM order_unit_allocations oua WHERE oua.order_id = o.id AND oua.state = 'RELEASED') AS alloc_released,
      (SELECT MAX(oua.allocated_at) FROM order_unit_allocations oua WHERE oua.order_id = o.id) AS last_alloc_at
    FROM orders o
    WHERE EXISTS (SELECT 1 FROM order_unit_allocations oua WHERE oua.order_id = o.id)
       OR EXISTS (SELECT 1 FROM packer_logs pl WHERE pl.shipment_id = o.shipment_id ${ALL ? sql`` : sql`AND pl.created_at >= ${since}`})
  )
  SELECT *,
    CASE
      WHEN packer_log_count > 0 AND alloc_total = 0 THEN 'HEALTHY_LEGACY_ONLY'
      WHEN packer_log_count = 0 AND alloc_total > 0 AND alloc_open > 0 THEN 'OPEN_NEW_FLOW'
      WHEN packer_log_count = 0 AND alloc_shipped = alloc_total - alloc_released AND alloc_shipped > 0 THEN 'DRIFT_MISSING_LEGACY'
      WHEN packer_log_count > 0 AND alloc_total > 0 AND alloc_shipped = alloc_total - alloc_released AND alloc_shipped > 0 THEN 'HEALTHY_SYNCED'
      WHEN packer_log_count > 0 AND alloc_open > 0 AND first_packed_at < last_alloc_at THEN 'DRIFT_ORPHAN_ALLOCATION'
      WHEN packer_log_count > 0 AND alloc_open > 0 AND first_packed_at >= last_alloc_at THEN 'DRIFT_STALE_ALLOCATION'
      WHEN packer_log_count > 0 AND alloc_shipped > 0 AND alloc_open > 0 THEN 'DRIFT_PARTIAL_SHIP'
      ELSE 'UNCLASSIFIED'
    END AS classification
  FROM order_activity
  ORDER BY classification, order_id DESC
`;

console.log(`Orders with activity in window: ${rows.length}\n`);

// ── Aggregate counts per category.
const counts = new Map();
for (const r of rows) counts.set(r.classification, (counts.get(r.classification) || 0) + 1);

const ORDER = ['HEALTHY_LEGACY_ONLY', 'HEALTHY_SYNCED', 'OPEN_NEW_FLOW', 'DRIFT_ORPHAN_ALLOCATION', 'DRIFT_STALE_ALLOCATION', 'DRIFT_MISSING_LEGACY', 'DRIFT_PARTIAL_SHIP', 'UNCLASSIFIED'];
const PAD = 26;
console.log('═══════ Classification ═══════');
for (const k of ORDER) {
  const n = counts.get(k) || 0;
  const marker = k.startsWith('DRIFT') && n > 0 ? '  ⚠ ' : '    ';
  console.log(`${marker}${k.padEnd(PAD)}  ${n}`);
}

// ── Sample rows per non-empty category (always shown for drift; --verbose for healthy).
console.log('\n═══════ Samples ═══════');
for (const k of ORDER) {
  const list = rows.filter((r) => r.classification === k);
  if (list.length === 0) continue;
  const isDrift = k.startsWith('DRIFT');
  if (!isDrift && !VERBOSE) continue;
  console.log(`\n${k}  (${list.length} order${list.length === 1 ? '' : 's'}):`);
  for (const r of list.slice(0, 10)) {
    console.log(
      `  #${String(r.order_id).padEnd(6)}  ${(r.order_label || '-').padEnd(22)}  ` +
      `legacy_status=${(r.order_status || '-').padEnd(11)}  ` +
      `pl=${r.packer_log_count}  alloc total=${r.alloc_total} shipped=${r.alloc_shipped} open=${r.alloc_open} released=${r.alloc_released}  ` +
      `last_packed=${r.last_packed_at?.toString().slice(0,10) || '-'} last_alloc=${r.last_alloc_at?.toString().slice(0,10) || '-'}`,
    );
  }
  if (list.length > 10) console.log(`  ... and ${list.length - 10} more`);
}

console.log('\n═══════ Summary ═══════');
const drift = ORDER.filter((k) => k.startsWith('DRIFT')).reduce((sum, k) => sum + (counts.get(k) || 0), 0);
console.log(`  Total drift rows requiring attention: ${drift}`);
console.log(`  Total healthy rows:                   ${rows.length - drift}`);
