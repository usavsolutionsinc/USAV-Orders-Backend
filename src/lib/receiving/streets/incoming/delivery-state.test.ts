import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DELIVERY_STATE_BUCKETS,
  deliveryStateCaseSql,
  deliveryStateWhereSql,
  deliveryStateFacets,
  isDeliveryState,
} from './delivery-state';
import { SHIPMENT_SCANNED_PREDICATE, CARRIER_MISMATCH_PREDICATE } from '../../delivered-unscanned';

// Semantic SQL normalize: collapse whitespace + strip spaces around ( ) , so
// cosmetic formatting (which Postgres ignores) doesn't cause a false mismatch,
// but any real logical difference still surfaces.
const sem = (s: string) => s.replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1').trim();

test('CASE arms appear in the documented order with matching THEN labels', () => {
  const sql = deliveryStateCaseSql();
  const order = [...sql.matchAll(/THEN '([A-Z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(order, [
    'RECEIVED',
    'DELIVERED_UNOPENED',
    'ARRIVING_TODAY',
    'STALLED',
    'TRACKING_UNAVAILABLE',
    'IN_TRANSIT',
    'AWAITING_TRACKING',
    'CARRIER_MISMATCH',
    'PENDING_CARRIER',
  ]);
  assert.match(sql, /ELSE 'UNKNOWN'\nEND$/);
});

test('no-drift invariant: shared buckets use the same predicate for CASE and WHERE (except PENDING_CARRIER)', () => {
  for (const b of DELIVERY_STATE_BUCKETS) {
    if (b.caseWhen != null && b.whereStandalone != null && b.state !== 'PENDING_CARRIER') {
      assert.equal(b.caseWhen, b.whereStandalone, `${b.state}: CASE and WHERE predicates must match`);
    }
  }
  const pc = DELIVERY_STATE_BUCKETS.find((b) => b.state === 'PENDING_CARRIER')!;
  assert.notEqual(pc.caseWhen, pc.whereStandalone, 'PENDING_CARRIER is the one documented asymmetry');
  // the standalone WHERE re-adds the mismatch guard the CASE arm leans on ordering for
  assert.match(deliveryStateWhereSql('PENDING_CARRIER')!, /AND NOT/);
});

test('facets are the states with a standalone WHERE (CASE-only labels excluded)', () => {
  const facets = deliveryStateFacets();
  assert.ok(facets.includes('DELIVERED_EMAIL')); // facet-only
  assert.ok(facets.includes('CARRIER_MISMATCH'));
  assert.ok(!facets.includes('RECEIVED')); // CASE-only
  assert.ok(!facets.includes('TRACKING_UNAVAILABLE')); // CASE-only label
  assert.ok(!facets.includes('UNKNOWN')); // ELSE
  assert.equal(deliveryStateWhereSql('TRACKING_UNAVAILABLE'), null);
});

test('isDeliveryState guards the union', () => {
  assert.equal(isDeliveryState('STALLED'), true);
  assert.equal(isDeliveryState('NOPE'), false);
});

// ── Equivalence to the route's inline SQL (the safety proof for wiring) ──────
// These transcribe the EXACT originals from app/api/receiving-lines/route.ts and
// assert the SoT reproduces them semantically — so replacing the inline copies
// with deliveryStateCaseSql()/deliveryStateWhereSql() is provably behavior-preserving.

test('deliveryStateCaseSql is semantically identical to the route CASE', () => {
  const ORIG_CASE = `CASE
                  WHEN COALESCE(rl.quantity_received, 0) > 0 OR rl.workflow_status <> 'EXPECTED'
                    THEN 'RECEIVED'
                  WHEN stn.is_delivered = true
                       AND NOT ${SHIPMENT_SCANNED_PREDICATE}
                    THEN 'DELIVERED_UNOPENED'
                  WHEN stn.latest_status_category = 'OUT_FOR_DELIVERY'
                    THEN 'ARRIVING_TODAY'
                  WHEN stn.id IS NOT NULL
                       AND COALESCE(stn.is_terminal, false) = false
                       AND COALESCE(stn.is_delivered, false) = false
                       AND (
                         stn.has_exception = true
                         OR (stn.latest_event_at IS NOT NULL
                             AND stn.latest_event_at < (NOW() - interval '72 hours'))
                       )
                    THEN 'STALLED'
                  WHEN stn.tracking_blocked_reason IS NOT NULL
                       AND COALESCE(stn.is_delivered, false) = false
                    THEN 'TRACKING_UNAVAILABLE'
                  WHEN stn.latest_status_category IN ('IN_TRANSIT','ACCEPTED','LABEL_CREATED')
                    THEN 'IN_TRANSIT'
                  WHEN stn.id IS NULL
                    THEN 'AWAITING_TRACKING'
                  WHEN ${CARRIER_MISMATCH_PREDICATE}
                    THEN 'CARRIER_MISMATCH'
                  WHEN stn.latest_status_category IS NULL OR stn.latest_status_category = 'UNKNOWN'
                    THEN 'PENDING_CARRIER'
                  ELSE 'UNKNOWN'
                END`;
  assert.equal(sem(deliveryStateCaseSql()), sem(ORIG_CASE));
});

test('each facet WHERE is semantically identical to the route WHERE arm', () => {
  const ORIG_WHERE: Record<string, string> = {
    DELIVERED_UNOPENED: `stn.is_delivered = true
           AND NOT ${SHIPMENT_SCANNED_PREDICATE}`,
    DELIVERED_EMAIL: `EXISTS (
             SELECT 1 FROM email_delivery_signals eds
              WHERE eds.order_number_norm = rl.zoho_purchaseorder_number_norm
                AND eds.organization_id = rl.organization_id
                AND eds.delivered_at > NOW() - interval '30 days'
           )
           AND NOT EXISTS (
             SELECT 1 FROM receiving_scans rs WHERE rs.receiving_id = r.id
           )`,
    ARRIVING_TODAY: `stn.latest_status_category = 'OUT_FOR_DELIVERY'`,
    STALLED: `stn.id IS NOT NULL
           AND COALESCE(stn.is_terminal, false) = false
           AND COALESCE(stn.is_delivered, false) = false
           AND (
             stn.has_exception = true
             OR (
               stn.latest_event_at IS NOT NULL
               AND stn.latest_event_at < (NOW() - interval '72 hours')
             )
           )`,
    IN_TRANSIT: `stn.latest_status_category IN ('IN_TRANSIT','ACCEPTED','LABEL_CREATED')`,
    AWAITING_TRACKING: `stn.id IS NULL`,
    PENDING_CARRIER: `stn.id IS NOT NULL
            AND (stn.latest_status_category IS NULL OR stn.latest_status_category = 'UNKNOWN')
            AND NOT ${CARRIER_MISMATCH_PREDICATE}`,
    CARRIER_MISMATCH: CARRIER_MISMATCH_PREDICATE,
  };
  for (const [state, orig] of Object.entries(ORIG_WHERE)) {
    const got = deliveryStateWhereSql(state as never);
    assert.ok(got != null, `${state} should have a standalone WHERE`);
    assert.equal(sem(got!), sem(orig), `${state} WHERE diverged from the route`);
  }
});
