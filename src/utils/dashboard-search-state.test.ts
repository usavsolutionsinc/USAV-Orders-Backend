import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractOrdersFromDashboardCacheEntry,
  findDashboardSelectedOrderInCache,
  getDashboardOrderViewFromSearch,
  patchDashboardSelectedOrderFromAssignment,
  resolveDashboardSelectedOrderCandidate,
  normalizeDashboardDetailsContext,
  normalizeDashboardOrderViewParams,
  parseDashboardOpenOrderId,
} from '@/utils/dashboard-search-state';

test('getDashboardOrderViewFromSearch prefers explicit view params', () => {
  assert.equal(getDashboardOrderViewFromSearch(new URLSearchParams('shipped=')), 'shipped');
  assert.equal(getDashboardOrderViewFromSearch(new URLSearchParams('unshipped=')), 'unshipped');
  assert.equal(getDashboardOrderViewFromSearch(new URLSearchParams('pending=')), 'pending');
  assert.equal(getDashboardOrderViewFromSearch(new URLSearchParams('fba=')), 'fba');
});

test('getDashboardOrderViewFromSearch falls back to pending', () => {
  assert.equal(getDashboardOrderViewFromSearch(new URLSearchParams('search=abc')), 'pending');
});

test('normalizeDashboardOrderViewParams clears competing view params', () => {
  const params = new URLSearchParams('pending=&search=abc&unshipped=');
  const next = normalizeDashboardOrderViewParams(params, 'shipped');

  assert.equal(next, 'shipped');
  assert.equal(params.has('pending'), false);
  assert.equal(params.has('unshipped'), false);
  assert.equal(params.has('fba'), false);
  assert.equal(params.has('shipped'), true);
  assert.equal(params.get('search'), 'abc');
});

test('parseDashboardOpenOrderId accepts only positive numeric ids', () => {
  assert.equal(parseDashboardOpenOrderId('123'), 123);
  assert.equal(parseDashboardOpenOrderId(' 42 '), 42);
  assert.equal(parseDashboardOpenOrderId('0'), null);
  assert.equal(parseDashboardOpenOrderId('-1'), null);
  assert.equal(parseDashboardOpenOrderId('abc'), null);
  assert.equal(parseDashboardOpenOrderId(null), null);
});

test('normalizeDashboardDetailsContext defaults from packed_at when missing', () => {
  assert.equal(normalizeDashboardDetailsContext({ packed_at: '2026-03-26 10:00:00' }), 'shipped');
  assert.equal(normalizeDashboardDetailsContext({ packed_at: null }), 'queue');
  assert.equal(normalizeDashboardDetailsContext({ packed_at: null }, 'shipped'), 'shipped');
});

test('extractOrdersFromDashboardCacheEntry handles supported cache shapes', () => {
  const order = { id: 7, packed_at: null } as any;

  assert.deepEqual(extractOrdersFromDashboardCacheEntry([order]), [order]);
  assert.deepEqual(extractOrdersFromDashboardCacheEntry({ orders: [order] }), [order]);
  assert.deepEqual(extractOrdersFromDashboardCacheEntry({ results: [order] }), [order]);
  assert.deepEqual(extractOrdersFromDashboardCacheEntry({ shipped: [order] }), [order]);
  assert.deepEqual(extractOrdersFromDashboardCacheEntry({ foo: [order] }), []);
  assert.deepEqual(extractOrdersFromDashboardCacheEntry(null), []);
});

test('findDashboardSelectedOrderInCache returns the first matching cached order with derived context', () => {
  const queuedOrder = { id: 11, packed_at: null } as any;
  const shippedOrder = { id: 12, packed_at: '2026-03-26 10:00:00' } as any;

  assert.deepEqual(
    findDashboardSelectedOrderInCache(
      [
        ['pending', { orders: [queuedOrder] }],
        ['shipped', { shipped: [shippedOrder] }],
      ],
      12
    ),
    { order: shippedOrder, context: 'shipped' }
  );
});

test('resolveDashboardSelectedOrderCandidate prefers cache over stored snapshot', () => {
  const cachedOrder = { id: 21, packed_at: null } as any;
  const storedOrder = { id: 21, packed_at: '2026-03-26 10:00:00' } as any;

  assert.deepEqual(
    resolveDashboardSelectedOrderCandidate({
      openOrderId: 21,
      cachedEntries: [['pending', { orders: [cachedOrder] }]],
      storedSelection: {
        order: storedOrder,
        context: 'shipped',
        savedAt: Date.now(),
      },
    }),
    { order: cachedOrder, context: 'queue' }
  );
});

test('resolveDashboardSelectedOrderCandidate falls back to stored snapshot when cache misses', () => {
  const storedOrder = { id: 31, packed_at: null } as any;

  assert.deepEqual(
    resolveDashboardSelectedOrderCandidate({
      openOrderId: 31,
      cachedEntries: [],
      storedSelection: {
        order: storedOrder,
        context: 'queue',
        savedAt: Date.now(),
      },
    }),
    { order: storedOrder, context: 'queue' }
  );
});

test('patchDashboardSelectedOrderFromAssignment updates only matching selected orders', () => {
  const current = {
    id: 77,
    packed_at: null,
    tester_id: 1,
    packer_id: null,
    ship_by_date: null,
    notes: 'old',
    condition: 'USED',
    shipping_tracking_number: 'AAA',
    item_number: 'OLD',
  } as any;

  const next = patchDashboardSelectedOrderFromAssignment(current, {
    orderIds: [77],
    testerId: 2,
    packerId: 4,
    shipByDate: '2026-03-30',
    notes: 'new',
    condition: 'NEW',
    shippingTrackingNumber: 'BBB',
    itemNumber: 'NEW-ITEM',
  });

  assert.equal(next?.tester_id, 2);
  assert.equal(next?.packer_id, 4);
  assert.equal(next?.ship_by_date, '2026-03-30');
  assert.equal(next?.notes, 'new');
  assert.equal(next?.condition, 'NEW');
  assert.equal(next?.shipping_tracking_number, 'BBB');
  assert.equal(next?.item_number, 'NEW-ITEM');
  assert.equal(patchDashboardSelectedOrderFromAssignment(current, { orderIds: [88], testerId: 9 }), current);
});
