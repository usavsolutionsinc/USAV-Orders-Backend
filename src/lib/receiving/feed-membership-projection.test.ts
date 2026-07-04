/**
 * DB-free tests for the receiving-triage → feed_memberships projection (Phase 4).
 * Run: npx tsx --test src/lib/receiving/feed-membership-projection.test.ts
 */

// FIRST: well-formed DATABASE_URL before the drizzle db barrel loads.
import '@/lib/assistant/test-db-url';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SQL } from 'drizzle-orm';
import { projectReceivingTriageMemberships, type FeedProjectionDeps } from './feed-membership-projection';

function fakes(upsertRows: unknown[] = [{ id: 1 }], flipRows: unknown[] = [{ id: 2 }]) {
  const cap: { queries: SQL[] } = { queries: [] };
  let call = 0;
  const deps: FeedProjectionDeps = {
    execute: async (q) => {
      cap.queries.push(q);
      return { rows: call++ === 0 ? upsertRows : flipRows };
    },
  };
  return { deps, cap };
}

test('projectReceivingTriageMemberships: two statements (upsert then flip), counts map to rows', async () => {
  const { deps, cap } = fakes([{ id: 10 }, { id: 11 }], [{ id: 20 }]);
  const out = await projectReceivingTriageMemberships(90, deps);
  assert.deepEqual(out, { success: true, upserted: 2, doneFlipped: 1, windowDays: 90 });
  assert.equal(cap.queries.length, 2); // upsert + flip-to-done, both set-based
});

test('projectReceivingTriageMemberships: clamps window to [1, 365], defaults NaN → 90', async () => {
  assert.equal((await projectReceivingTriageMemberships(10_000, fakes().deps)).windowDays, 365);
  assert.equal((await projectReceivingTriageMemberships(0, fakes().deps)).windowDays, 1);
  assert.equal((await projectReceivingTriageMemberships(Number.NaN, fakes().deps)).windowDays, 90);
});

test('projectReceivingTriageMemberships: empty result → zero counts, still success', async () => {
  const out = await projectReceivingTriageMemberships(90, fakes([], []).deps);
  assert.equal(out.success, true);
  assert.equal(out.upserted, 0);
  assert.equal(out.doneFlipped, 0);
});
