import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveOrderLifecycleStage,
  resolveFulfillmentLane,
  resolveOutboundStage,
  carrierHasCustody,
  hasLeftWarehouse,
  FULFILLMENT_BOARD_LANES,
  UNSHIPPED_LIFECYCLE_RULES,
  SHIPMENT_STATUS_CATEGORIES,
  type OrderLifecycleSignals,
  type OutboundSignals,
} from './order-lifecycle';
import {
  sqlInList,
  PACK_ACTIVITY_TYPES,
  TECH_TEST_ACTIVITY_TYPES,
  VELOCITY_ACTIVITY_TYPES,
} from './station-activity';

// ─── Oracles: the ORIGINAL hardcoded logic this module replaced ──────────────
// (verbatim from the pre-W2 unshipped-state.ts so parity is provable.)
function legacyUnshipped(input: OrderLifecycleSignals): string {
  if (input.packedAt) return 'PACKED_STAGED';
  if (String(input.outOfStock ?? '').trim() !== '') return 'BLOCKED';
  if (input.hasTechScan) return 'TESTED';
  if (input.shipmentId != null && String(input.shipmentId) !== '') return 'PENDING';
  return 'AWAITING_LABEL';
}
function legacyFulfillment(input: OrderLifecycleSignals): string {
  if (String(input.outOfStock ?? '').trim() !== '') return 'BLOCKED';
  if (input.hasTechScan) return 'TESTED';
  return 'PENDING';
}

// Exhaustive truth table over every signal that affects the derivation.
const SHIPMENTS: Array<number | string | null> = [null, '', 0, 12247, '12247'];
const BOOLS: Array<boolean | null> = [true, false, null];
const PACKED: Array<string | null> = [null, '2026-06-28T00:00:00Z'];
const OOS: Array<string | null> = [null, '', '  ', 'out of stock'];

function* allSignals(): Generator<OrderLifecycleSignals> {
  for (const shipmentId of SHIPMENTS)
    for (const hasTechScan of BOOLS)
      for (const packedAt of PACKED)
        for (const outOfStock of OOS)
          yield { shipmentId, hasTechScan, packedAt, outOfStock };
}

test('resolveOrderLifecycleStage matches the legacy deriveUnshippedState for every signal combo', () => {
  for (const s of allSignals()) {
    assert.equal(resolveOrderLifecycleStage(s), legacyUnshipped(s), JSON.stringify(s));
  }
});

test('resolveFulfillmentLane matches the legacy deriveFulfillmentState for every signal combo', () => {
  for (const s of allSignals()) {
    assert.equal(resolveFulfillmentLane(s), legacyFulfillment(s), JSON.stringify(s));
  }
});

test('the bug fixture: a labeled, tech-scanned order resolves to TESTED', () => {
  const tested: OrderLifecycleSignals = { shipmentId: 12247, hasTechScan: true, packedAt: null, outOfStock: null };
  assert.equal(resolveOrderLifecycleStage(tested), 'TESTED');
  assert.equal(resolveFulfillmentLane(tested), 'TESTED');
});

test('a labeled order with no tech scan sits in PENDING', () => {
  const pending: OrderLifecycleSignals = { shipmentId: 12247, hasTechScan: false, packedAt: null, outOfStock: null };
  assert.equal(resolveFulfillmentLane(pending), 'PENDING');
});

test('rule set is ordered, first-match-wins, and covers exactly the non-default stages', () => {
  assert.deepEqual(
    UNSHIPPED_LIFECYCLE_RULES.map((r) => r.stage),
    ['PACKED_STAGED', 'BLOCKED', 'TESTED', 'PENDING'],
  );
});

test('board descriptor renders the three fulfillment lanes in pipeline order', () => {
  assert.deepEqual(FULFILLMENT_BOARD_LANES.map((l) => l.id), ['PENDING', 'TESTED', 'BLOCKED']);
  // every lane binds a known icon key
  for (const lane of FULFILLMENT_BOARD_LANES) {
    assert.ok(['clock', 'check', 'alert'].includes(lane.iconKey));
  }
});

// ─── Outbound (post-dock) parity ─────────────────────────────────────────────
// Oracle: the ORIGINAL deriveOutboundState / carrierHasCustody / hasLeftWarehouse
// verbatim from the pre-W2 outbound-state.ts.
const CUSTODY = new Set(['ACCEPTED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED']);
function legacyCustody(i: OutboundSignals): boolean {
  return CUSTODY.has(String(i.latestStatusCategory ?? '').toUpperCase());
}
function legacyLeft(i: OutboundSignals): boolean {
  return Boolean(i.shipConfirmedAt) || legacyCustody(i);
}
function legacyOutbound(i: OutboundSignals): string {
  const cat = String(i.latestStatusCategory ?? '').toUpperCase();
  const hasPack = Boolean(i.packedAt);
  const hasShipOut = Boolean(i.shipConfirmedAt);
  const delivered = cat === 'DELIVERED' || (i.isTerminal === true && cat !== 'RETURNED');
  const custody = legacyCustody(i);
  if (delivered) return 'DELIVERED';
  if (hasShipOut && !hasPack) return 'PROCESS_GAP';
  if (i.hasException || i.stalled) return 'EXCEPTION';
  if (custody && hasShipOut) return 'IN_CUSTODY';
  if (custody && !hasShipOut) return 'ORPHAN';
  if (hasShipOut) return 'SCANNED_OUT';
  return 'PACKED_STAGED';
}

const CATEGORIES = [null, '', 'LABEL_CREATED', 'ACCEPTED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED', 'EXCEPTION', 'UNKNOWN'];
const TS = [null, '2026-06-28T00:00:00Z'];

function* allOutbound(): Generator<OutboundSignals> {
  for (const latestStatusCategory of CATEGORIES)
    for (const packedAt of TS)
      for (const shipConfirmedAt of TS)
        for (const isTerminal of [true, false, null] as Array<boolean | null>)
          for (const hasException of [true, false, null] as Array<boolean | null>)
            for (const stalled of [true, false, null] as Array<boolean | null>)
              yield { latestStatusCategory, packedAt, shipConfirmedAt, isTerminal, hasException, stalled };
}

test('resolveOutboundStage matches the legacy deriveOutboundState for every signal combo', () => {
  for (const s of allOutbound()) {
    assert.equal(resolveOutboundStage(s), legacyOutbound(s), JSON.stringify(s));
  }
});

test('carrierHasCustody + hasLeftWarehouse match the legacy predicates', () => {
  for (const s of allOutbound()) {
    assert.equal(carrierHasCustody(s), legacyCustody(s), JSON.stringify(s));
    assert.equal(hasLeftWarehouse(s), legacyLeft(s), JSON.stringify(s));
  }
});

// ─── SQL vocabulary: generated IN-clause fragments must equal the originals ───
test('SHIPMENT_STATUS_CATEGORIES equals the original orders-route tuple', () => {
  assert.deepEqual(
    [...SHIPMENT_STATUS_CATEGORIES],
    ['LABEL_CREATED', 'ACCEPTED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'RETURNED', 'UNKNOWN'],
  );
});

test('sqlInList generated fragments are byte-identical to the replaced SQL literals', () => {
  // orders/route.ts  →  activity_type IN (<this>)
  assert.equal(sqlInList(PACK_ACTIVITY_TYPES), `'PACK_COMPLETED', 'PACK_SCAN'`);
  // dashboard/operations + staff-goals  →  activity_type IN (<this>)
  assert.equal(
    sqlInList(VELOCITY_ACTIVITY_TYPES),
    `'TRACKING_SCANNED', 'FNSKU_SCANNED', 'PACK_SCAN', 'PACK_COMPLETED', 'FBA_READY'`,
  );
  // dashboard/operations tested-today  →  activity_type IN (<this>)
  assert.equal(sqlInList(TECH_TEST_ACTIVITY_TYPES), `'TRACKING_SCANNED', 'FNSKU_SCANNED'`);
});
