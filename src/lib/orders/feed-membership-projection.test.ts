import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectOrdersUnshippedMemberships, type FeedProjectionDeps } from './feed-membership-projection';

/** Fake Deps: call 1 = fetch (canned rows), call 2 = upsert, call 3 = flip. */
function fakeDeps(fetchRows: unknown[], flipCount = 0): { deps: FeedProjectionDeps; calls: () => number } {
  let n = 0;
  const deps: FeedProjectionDeps = {
    execute: async () => {
      n += 1;
      if (n === 1) return { rows: fetchRows };
      if (n === 2) return { rows: [] }; // upsert (result ignored; upserted = memberships.length)
      return { rows: Array.from({ length: flipCount }, (_, i) => ({ id: i })) }; // flip
    },
  };
  return { deps, calls: () => n };
}

const row = (id: number, hasTechScan: boolean, outOfStock: string) => ({
  id,
  organization_id: 'org-1',
  shipment_id: 100 + id,
  has_tech_scan: hasTechScan,
  out_of_stock: outOfStock,
  occurred_at: new Date('2026-01-0' + ((id % 9) + 1)),
  title: `Order ${id}`,
});

test('computes the fulfillment lane in NODE (deriveFulfillmentState) and buckets by lane', async () => {
  const fetchRows = [
    row(1, false, ''),      // PENDING (untested, in stock)
    row(2, true, ''),       // TESTED
    row(3, true, 'OOS'),    // BLOCKED — out_of_stock wins over tech scan
    row(4, false, '   '),   // PENDING — whitespace out_of_stock trims to empty (matches isOutOfStock)
    row(5, false, 'short'), // BLOCKED — any non-empty out_of_stock
  ];
  const { deps } = fakeDeps(fetchRows, 2);
  const res = await projectOrdersUnshippedMemberships(90, deps);

  assert.equal(res.success, true);
  assert.equal(res.upserted, 5);
  assert.deepEqual(res.byLane, { pending: 2, tested: 1, blocked: 2 });
  assert.equal(res.doneFlipped, 2);
});

test('empty queue: skips the upsert chunk, still runs the fetch + done-flip', async () => {
  const { deps, calls } = fakeDeps([], 0);
  const res = await projectOrdersUnshippedMemberships(90, deps);
  assert.equal(res.upserted, 0);
  assert.deepEqual(res.byLane, { pending: 0, tested: 0, blocked: 0 });
  assert.equal(calls(), 2, 'fetch + flip only — no upsert call when there is nothing to upsert');
});

test('windowDays clamps to [1, 365] (NaN → 90 default)', async () => {
  const mk = (): FeedProjectionDeps => ({ execute: async () => ({ rows: [] }) });
  assert.equal((await projectOrdersUnshippedMemberships(9999, mk())).windowDays, 365);
  assert.equal((await projectOrdersUnshippedMemberships(0, mk())).windowDays, 1);
  assert.equal((await projectOrdersUnshippedMemberships(Number.NaN, mk())).windowDays, 90);
});
