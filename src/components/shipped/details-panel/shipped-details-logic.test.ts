import test from 'node:test';
import assert from 'node:assert/strict';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import { deriveShippedHeaderMeta, resolveDeleteRequest } from './shipped-details-logic';

/** Minimal ShippedOrder factory — only the fields the logic reads. */
function makeShipped(overrides: Record<string, unknown>): ShippedOrder {
  return { id: 1, ...overrides } as unknown as ShippedOrder;
}

// ─── resolveDeleteRequest ─────────────────────────────────────────────────────

test('resolveDeleteRequest: negative id → exception delete (absolute id)', () => {
  assert.deepEqual(resolveDeleteRequest(makeShipped({ id: -42 })), {
    rowSource: 'exception',
    exceptionId: 42,
  });
});

test('resolveDeleteRequest: row_source exception → exception delete', () => {
  assert.deepEqual(resolveDeleteRequest(makeShipped({ id: 7, row_source: 'exception' })), {
    rowSource: 'exception',
    exceptionId: 7,
  });
});

test('resolveDeleteRequest: invalid / zero id → null', () => {
  assert.equal(resolveDeleteRequest(makeShipped({ id: 0 })), null);
  assert.equal(resolveDeleteRequest(makeShipped({ id: 'abc' })), null);
});

for (const trackingType of ['FBA', 'FNSKU', 'SKU', 'SCAN', 'fba']) {
  test(`resolveDeleteRequest: ${trackingType} tracking → packing_log delete`, () => {
    const result = resolveDeleteRequest(makeShipped({
      id: 100,
      tracking_type: trackingType,
      packer_log_id: 55,
      station_activity_log_id: 99,
    }));
    assert.deepEqual(result, { rowSource: 'packing_log', activityLogId: 99, packerLogId: 55 });
  });
}

test('resolveDeleteRequest: activity-log-keyed row → packing_log even without FBA type', () => {
  // station_activity_log_id === id ⇒ isLikelyActivityLogRow
  const result = resolveDeleteRequest(makeShipped({ id: 100, station_activity_log_id: 100 }));
  assert.deepEqual(result, { rowSource: 'packing_log', activityLogId: 100, packerLogId: undefined });
});

test('resolveDeleteRequest: plain order → order delete', () => {
  assert.deepEqual(resolveDeleteRequest(makeShipped({ id: 100, tracking_type: 'UPS' })), {
    rowSource: 'order',
    orderId: 100,
  });
});

// ─── deriveShippedHeaderMeta ──────────────────────────────────────────────────

test('deriveShippedHeaderMeta: tech scan → emerald tested status', () => {
  const meta = deriveShippedHeaderMeta(makeShipped({ id: 5, has_tech_scan: true, tested_by: 1 }));
  assert.equal(meta.hasTechScan, true);
  assert.equal(meta.statusTone, 'emerald');
  assert.match(meta.statusLabel, /^Tested by /);
});

test('deriveShippedHeaderMeta: out of stock → red status', () => {
  const meta = deriveShippedHeaderMeta(makeShipped({ id: 5, out_of_stock: 'Backordered' }));
  assert.equal(meta.statusTone, 'red');
  assert.equal(meta.statusLabel, 'Backordered');
  assert.equal(meta.hasOutOfStock, true);
});

test('deriveShippedHeaderMeta: nothing → yellow pending', () => {
  const meta = deriveShippedHeaderMeta(makeShipped({ id: 5 }));
  assert.equal(meta.statusTone, 'yellow');
  assert.equal(meta.statusLabel, 'Pending');
});

test('deriveShippedHeaderMeta: missing order_id → exceptions fallback to abs id', () => {
  const meta = deriveShippedHeaderMeta(makeShipped({ id: -8, order_id: '' }));
  assert.equal(meta.showExceptionsFallback, true);
  assert.equal(meta.orderIdDisplay, '8');
  assert.equal(meta.canEditAssignment, false);
});

test('deriveShippedHeaderMeta: real order_id → no fallback, editable', () => {
  const meta = deriveShippedHeaderMeta(makeShipped({ id: 8, order_id: 'ORD-123' }));
  assert.equal(meta.showExceptionsFallback, false);
  assert.equal(meta.orderIdDisplay, 'ORD-123');
  assert.equal(meta.canEditAssignment, true);
});
