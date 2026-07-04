/**
 * DB-free tests for the nightly signal → insight_links rollup domain fn.
 * Run: npx tsx --test src/lib/operations/signal-rollup.test.ts
 */

// Must be FIRST: sets a well-formed DATABASE_URL before signal-rollup.ts loads
// @/lib/drizzle/db (whose neon() validates the URL at module load). The fn
// under test routes every query through an injected fake — no DB is opened.
import '@/lib/assistant/test-db-url';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SQL } from 'drizzle-orm';
import { runSignalInsightRollup, type SignalRollupDeps } from './signal-rollup';

function fakes(rows: unknown[] = [{ id: 1 }, { id: 2 }]) {
  const cap: { queries: SQL[] } = { queries: [] };
  const deps: SignalRollupDeps = {
    execute: async (q) => {
      cap.queries.push(q);
      return { rows };
    },
  };
  return { deps, cap };
}

test('runSignalInsightRollup: one set-based statement, rowsWritten = returned rows', async () => {
  const { deps, cap } = fakes([{ id: 10 }, { id: 11 }, { id: 12 }]);
  const out = await runSignalInsightRollup(30, deps);
  assert.deepEqual(out, { success: true, rowsWritten: 3, windowDays: 30 });
  assert.equal(cap.queries.length, 1); // a single INSERT…SELECT, not per-org fan-out
});

test('runSignalInsightRollup: clamps window to [1, 365] and defaults NaN → 30', async () => {
  const over = fakes([]);
  assert.equal((await runSignalInsightRollup(10_000, over.deps)).windowDays, 365);

  const under = fakes([]);
  assert.equal((await runSignalInsightRollup(0, under.deps)).windowDays, 1);

  const nan = fakes([]);
  assert.equal((await runSignalInsightRollup(Number.NaN, nan.deps)).windowDays, 30);

  const frac = fakes([]);
  assert.equal((await runSignalInsightRollup(30.7, frac.deps)).windowDays, 31); // rounds
});

test('runSignalInsightRollup: empty result → rowsWritten 0, still success', async () => {
  const { deps } = fakes([]);
  const out = await runSignalInsightRollup(30, deps);
  assert.equal(out.success, true);
  assert.equal(out.rowsWritten, 0);
});
