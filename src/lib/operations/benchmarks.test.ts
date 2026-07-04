/**
 * DB-free unit tests for getBenchmarkComparison. Run: npm run test:operations-journey
 * (co-scheduled with the operations suite).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getBenchmarkComparison, type BenchmarksDeps } from './benchmarks';

const ORG = '11111111-2222-3333-4444-555555555555';

function fakes(opts: {
  eventRows?: Array<{ event_type: string; count: number }>;
  benchmarkRows?: Array<Record<string, unknown>>;
  failBenchmarks?: boolean;
} = {}) {
  const cap: Array<{ orgId: string; text: string; params: readonly unknown[] }> = [];
  const deps: BenchmarksDeps = {
    query: (async (orgId: string, text: string, params?: readonly unknown[]) => {
      cap.push({ orgId, text, params: params ?? [] });
      if (text.includes('insight_links')) {
        if (opts.failBenchmarks) throw new Error('relation "insight_links" does not exist');
        return { rows: opts.benchmarkRows ?? [] };
      }
      return { rows: opts.eventRows ?? [] };
    }) as any,
  };
  return { deps, cap };
}

test('computes fail% and return% from org-scoped event counts', async () => {
  const { deps, cap } = fakes({
    eventRows: [
      { event_type: 'TEST_PASS', count: 88 },
      { event_type: 'TEST_FAIL', count: 12 },
      { event_type: 'SHIPPED', count: 200 },
      { event_type: 'RETURNED', count: 18 },
    ],
    benchmarkRows: [{ subject_ref: 'test_fail_reason' }],
  });
  const out = await getBenchmarkComparison(ORG, 30, deps);
  assert.equal(out.actuals.testFailPct, 12);
  assert.equal(out.actuals.testEvents, 100);
  assert.equal(out.actuals.returnPct, 9);
  assert.equal(out.benchmarks.length, 1);
  for (const q of cap) {
    assert.equal(q.orgId, ORG);
    assert.equal(q.params[0], ORG); // explicit org predicate on every query
    // Regression: inventory_events has occurred_at, NOT created_at.
    if (q.text.includes('inventory_events')) {
      assert.ok(!q.text.includes('created_at'), 'phantom inventory_events.created_at');
    }
  }
});

test('no activity in range → null percentages, zero counts', async () => {
  const { deps } = fakes();
  const out = await getBenchmarkComparison(ORG, 7, deps);
  assert.deepEqual(out.actuals, {
    rangeDays: 7,
    testFailPct: null,
    testEvents: 0,
    returnPct: null,
    shippedCount: 0,
    returnedCount: 0,
  });
});

test('insight_links failure degrades to empty benchmarks, never throws (pre-apply safety)', async () => {
  const { deps } = fakes({
    eventRows: [{ event_type: 'TEST_PASS', count: 5 }],
    failBenchmarks: true,
  });
  const out = await getBenchmarkComparison(ORG, 30, deps);
  assert.deepEqual(out.benchmarks, []);
  assert.equal(out.actuals.testEvents, 5);
});

test('rangeDays clamped to [1, 365]', async () => {
  const { deps, cap } = fakes();
  await getBenchmarkComparison(ORG, 0, deps);
  await getBenchmarkComparison(ORG, 9999, deps);
  assert.equal(cap[0].params[1], 1);
  assert.equal(cap[2].params[1], 365);
});
