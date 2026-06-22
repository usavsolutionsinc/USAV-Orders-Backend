import test from 'node:test';
import assert from 'node:assert/strict';
import type { DashboardData } from '@/features/operations/types';
import {
  ACTIVITY_FEED_LIMIT,
  mergeKpiUpdate,
  prependActivityEvent,
  selectKpiValue,
} from './operations-dashboard-logic';

function makeData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    summary: {
      all: { value: 10, delta: 1 },
      tested: { value: 5, delta: 2 },
      repair: { value: 3, delta: -1 },
      outOfStock: { value: 0, delta: 0 },
      pendingLate: { value: 0, delta: 0 },
      fba: { value: 7, delta: 4 },
    },
    staffProgress: [],
    activityFeed: [],
    ...overrides,
  };
}

function makeEvent(id: string): DashboardData['activityFeed'][number] {
  return { id, timestamp: '2026-06-21T00:00:00Z', type: 'scan', source: 'tech', summary: `event ${id}` };
}

// ─── mergeKpiUpdate ───────────────────────────────────────────────────────────

test('mergeKpiUpdate: replaces one summary category, leaves the rest intact', () => {
  const next = mergeKpiUpdate(makeData(), { category: 'tested', update: { value: 99, delta: 9 } });
  assert.deepEqual(next?.summary.tested, { value: 99, delta: 9 });
  assert.deepEqual(next?.summary.all, { value: 10, delta: 1 });
});

test('mergeKpiUpdate: does not mutate the original', () => {
  const data = makeData();
  mergeKpiUpdate(data, { category: 'tested', update: { value: 99, delta: 9 } });
  assert.deepEqual(data.summary.tested, { value: 5, delta: 2 });
});

test('mergeKpiUpdate: undefined cache stays undefined', () => {
  assert.equal(mergeKpiUpdate(undefined, { category: 'all', update: { value: 1, delta: 0 } }), undefined);
});

// ─── prependActivityEvent ─────────────────────────────────────────────────────

test('prependActivityEvent: newest event lands at the front', () => {
  const data = makeData({ activityFeed: [makeEvent('a')] });
  const next = prependActivityEvent(data, makeEvent('b'));
  assert.deepEqual(next?.activityFeed.map((e) => e.id), ['b', 'a']);
});

test(`prependActivityEvent: caps the feed at ${ACTIVITY_FEED_LIMIT}`, () => {
  const existing = Array.from({ length: ACTIVITY_FEED_LIMIT }, (_, i) => makeEvent(`e${i}`));
  const next = prependActivityEvent(makeData({ activityFeed: existing }), makeEvent('new'));
  assert.equal(next?.activityFeed.length, ACTIVITY_FEED_LIMIT);
  assert.equal(next?.activityFeed[0].id, 'new');
  assert.equal(next?.activityFeed[ACTIVITY_FEED_LIMIT - 1].id, `e${ACTIVITY_FEED_LIMIT - 2}`);
});

test('prependActivityEvent: undefined cache stays undefined', () => {
  assert.equal(prependActivityEvent(undefined, makeEvent('x')), undefined);
});

// ─── selectKpiValue ───────────────────────────────────────────────────────────

test('selectKpiValue: maps each kind to its summary value', () => {
  const { summary } = makeData();
  assert.equal(selectKpiValue('velocity', summary), 10);
  assert.equal(selectKpiValue('tested', summary), 5);
  assert.equal(selectKpiValue('fba', summary), 7);
  assert.equal(selectKpiValue('repair', summary), 3);
});

test('selectKpiValue: null kind or missing summary → undefined', () => {
  const { summary } = makeData();
  assert.equal(selectKpiValue(null, summary), undefined);
  assert.equal(selectKpiValue('velocity', undefined), undefined);
});
