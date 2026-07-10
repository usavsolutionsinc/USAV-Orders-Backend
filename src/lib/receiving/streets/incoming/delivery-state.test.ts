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
    'DELIVERED_NOT_UNBOXED',
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

test('no-drift invariant: shared buckets use the same predicate for CASE and WHERE (except documented asymmetries)', () => {
  const asymmetries = new Set(['PENDING_CARRIER', 'DELIVERED_NOT_UNBOXED']);
  for (const b of DELIVERY_STATE_BUCKETS) {
    if (b.caseWhen != null && b.whereStandalone != null && !asymmetries.has(b.state)) {
      assert.equal(b.caseWhen, b.whereStandalone, `${b.state}: CASE and WHERE predicates must match`);
    }
  }
  const pc = DELIVERY_STATE_BUCKETS.find((b) => b.state === 'PENDING_CARRIER')!;
  assert.notEqual(pc.caseWhen, pc.whereStandalone, 'PENDING_CARRIER is the one documented asymmetry');
  // the standalone WHERE re-adds the mismatch guard the CASE arm leans on ordering for
  assert.match(deliveryStateWhereSql('PENDING_CARRIER')!, /AND NOT/);
  const dnu = DELIVERY_STATE_BUCKETS.find((b) => b.state === 'DELIVERED_NOT_UNBOXED')!;
  assert.notEqual(dnu.caseWhen, dnu.whereStandalone, 'DELIVERED_NOT_UNBOXED CASE is scanned-only; WHERE is broader');
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

test('deliveryStateCaseSql includes DELIVERED_NOT_UNBOXED after DELIVERED_UNOPENED', () => {
  const sql = deliveryStateCaseSql();
  assert.match(sql, /THEN 'DELIVERED_UNOPENED'/);
  assert.match(sql, /THEN 'DELIVERED_NOT_UNBOXED'/);
  const unopened = sql.indexOf("THEN 'DELIVERED_UNOPENED'");
  const notUnboxed = sql.indexOf("THEN 'DELIVERED_NOT_UNBOXED'");
  assert.ok(unopened < notUnboxed);
});

test('each facet WHERE is present for known facets', () => {
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
  const dnu = deliveryStateWhereSql('DELIVERED_NOT_UNBOXED');
  assert.ok(dnu);
  assert.match(dnu!, /stn\.is_delivered = true/);
  assert.match(dnu!, /unboxed_at IS NULL/);
});
