/**
 * Unit tests for the single-source-of-truth delivered-unscanned helper
 * (Phase B). Asserts the count path and the list path share the exact same
 * canonical base SQL, so `count === list.length` holds by construction.
 * Run: `npm run test:shipping-status`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deliveredUnscannedBaseSql,
  getDeliveredUnscannedCount,
  INBOUND_SHIPMENT_PREDICATE,
  DELIVERED_UNSCANNED_WINDOW_DAYS,
} from './delivered-unscanned';

test('base SQL embeds the inbound predicate, dedupe, and unscanned guard', () => {
  const sql = deliveredUnscannedBaseSql('$1');
  assert.match(sql, /DISTINCT ON \(stn\.tracking_number_normalized\)/);
  assert.match(sql, /stn\.is_delivered = true/);
  assert.match(sql, /NOT EXISTS/);          // no receiving_scans
  assert.match(sql, /receiving_scans rs/);
  assert.ok(sql.includes(INBOUND_SHIPMENT_PREDICATE));
  // Window is parameterized, not hard-coded.
  assert.match(sql, /\$1 \|\| ' days'/);
});

test('window param placeholder is substituted verbatim', () => {
  assert.match(deliveredUnscannedBaseSql('$3'), /\$3 \|\| ' days'/);
});

test('getDeliveredUnscannedCount wraps the canonical base and binds the window', async () => {
  let capturedSql = '';
  let capturedValues: unknown[] | undefined;
  const fakeClient = {
    query: async (text: string, values?: unknown[]) => {
      capturedSql = text;
      capturedValues = values;
      return { rows: [{ n: 7 }] };
    },
  };

  const n = await getDeliveredUnscannedCount(fakeClient as never);
  assert.equal(n, 7);
  // Count must wrap the *identical* base body the list uses.
  assert.ok(capturedSql.includes(deliveredUnscannedBaseSql('$1')));
  assert.match(capturedSql, /COUNT\(\*\)::int AS n/);
  assert.deepEqual(capturedValues, [String(DELIVERED_UNSCANNED_WINDOW_DAYS)]);
});

test('count tolerates an empty result set', async () => {
  const fakeClient = { query: async () => ({ rows: [] as Array<{ n: number }> }) };
  assert.equal(await getDeliveredUnscannedCount(fakeClient as never), 0);
});
