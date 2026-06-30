/**
 * Unit test for the Phase-0 cached-carton resolver — DB/React-free.
 *
 * Run: `tsx --test src/lib/receiving/scan/resolvers/cached-carton.test.ts`
 *
 * This is the template the rest of the scan-ladder rungs follow: a pure resolver
 * fed an injected `readCachedRows` snapshot, asserted on its `ScanResolution`
 * return — no query client, no DOM, no network.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCachedCarton } from './cached-carton';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

/** Build a row carrying only the fields the resolver reads. */
function row(p: Partial<ReceivingLineRow>): ReceivingLineRow {
  return {
    id: 1,
    receiving_id: 100,
    tracking_number: null,
    zoho_purchaseorder_number: null,
    zoho_purchaseorder_id: null,
    quantity_received: 0,
    quantity_expected: null,
    ...p,
  } as unknown as ReceivingLineRow;
}

test('returns null when no row matches', () => {
  const res = resolveCachedCarton(
    { value: '1Z999', mode: 'tracking' },
    { readCachedRows: () => [] },
  );
  assert.equal(res, null);
});

test('matches tracking in tracking mode, normalizing case + punctuation', () => {
  const r = row({ receiving_id: 200, tracking_number: '1z-999 aaa' });
  const res = resolveCachedCarton(
    { value: '1Z999AAA', mode: 'tracking' },
    { readCachedRows: () => [r] },
  );
  assert.equal(res?.kind, 'cached-carton');
  assert.equal(res?.receivingId, 200);
  assert.equal(res?.row, r);
});

test('order mode matches the PO#, ignoring a tracking-only row', () => {
  const tnRow = row({ id: 2, receiving_id: 2, tracking_number: 'PO1234' });
  const poRow = row({ id: 1, receiving_id: 1, zoho_purchaseorder_number: 'PO-1234' });
  const res = resolveCachedCarton(
    { value: 'po 1234', mode: 'order' },
    { readCachedRows: () => [tnRow, poRow] },
  );
  assert.equal(res?.receivingId, 1);
});

test('prefers an OPEN line over a fully-received one in the same carton', () => {
  const full = row({ id: 1, receiving_id: 9, tracking_number: 'T1', quantity_expected: 2, quantity_received: 2 });
  const open = row({ id: 2, receiving_id: 9, tracking_number: 'T1', quantity_expected: 2, quantity_received: 1 });
  const res = resolveCachedCarton(
    { value: 'T1', mode: 'tracking' },
    { readCachedRows: () => [full, open] },
  );
  assert.equal(res?.row.id, 2);
});

test('skips EXPECTED-only incoming rows (no receiving_id)', () => {
  const expected = row({ receiving_id: null, tracking_number: 'T2' });
  const res = resolveCachedCarton(
    { value: 'T2', mode: 'tracking' },
    { readCachedRows: () => [expected] },
  );
  assert.equal(res, null);
});

test('auto mode matches either a PO# or a tracking#', () => {
  const tn = row({ receiving_id: 5, tracking_number: 'TRK5' });
  assert.equal(
    resolveCachedCarton({ value: 'trk5', mode: 'auto' }, { readCachedRows: () => [tn] })?.receivingId,
    5,
  );
  const po = row({ receiving_id: 6, zoho_purchaseorder_number: 'PO6' });
  assert.equal(
    resolveCachedCarton({ value: 'po6', mode: 'auto' }, { readCachedRows: () => [po] })?.receivingId,
    6,
  );
});

test('carries the PO id through to poIds for the onResult echo', () => {
  const r = row({ receiving_id: 7, tracking_number: 'T7', zoho_purchaseorder_id: '  88  ' });
  const res = resolveCachedCarton(
    { value: 'T7', mode: 'tracking' },
    { readCachedRows: () => [r] },
  );
  assert.deepEqual(res?.poIds, ['88']);
});
