/**
 * Unit test for the internal-handle resolver — DB/React-free.
 *
 * Run: `tsx --test src/lib/receiving/scan/resolvers/internal-code.test.ts`
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInternalCode } from './internal-code';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import type { ResolvedTestingScan } from '@/lib/testing/resolve-testing-scan';

function row(p: Partial<ReceivingLineRow>): ReceivingLineRow {
  return {
    id: 1,
    receiving_id: 100,
    zoho_purchaseorder_id: null,
    quantity_received: 0,
    quantity_expected: null,
    ...p,
  } as unknown as ReceivingLineRow;
}

/** A resolveCode dep that returns a fixed outcome and records the call. */
function fakeResolve(outcome: ResolvedTestingScan | null) {
  const calls: string[] = [];
  const resolveCode = async (value: string) => {
    calls.push(value);
    return outcome;
  };
  return { resolveCode, calls };
}

const alwaysCode = () => true;

test('order mode + not-a-code → null WITHOUT calling resolveCode', async () => {
  const { resolveCode, calls } = fakeResolve({ kind: 'line', row: row({}), via: 'po' });
  const res = await resolveInternalCode(
    { value: 'PO-1234', mode: 'order' },
    { looksLikeCode: () => false, resolveCode },
  );
  assert.equal(res, null);
  assert.equal(calls.length, 0); // gate short-circuited before the I/O
});

test('line outcome → opens that row, via carried through', async () => {
  const r = row({ id: 7, receiving_id: 70, zoho_purchaseorder_id: 'PO9' });
  const { resolveCode } = fakeResolve({ kind: 'line', row: r, via: 'serial' });
  const res = await resolveInternalCode(
    { value: 'SN123', mode: 'auto' },
    { looksLikeCode: alwaysCode, resolveCode },
  );
  assert.equal(res?.kind, 'internal-code');
  assert.equal(res?.pick, r);
  assert.equal(res?.via, 'serial');
  assert.equal(res?.receivingId, 70);
  assert.deepEqual(res?.poIds, ['PO9']);
});

test('multi outcome → prefers the single OPEN line', async () => {
  const full = row({ id: 1, receiving_id: 9, quantity_expected: 2, quantity_received: 2 });
  const open = row({ id: 2, receiving_id: 9, quantity_expected: 2, quantity_received: 1 });
  const { resolveCode } = fakeResolve({ kind: 'multi', rows: [full, open], receivingId: 9, via: 'handle' });
  const res = await resolveInternalCode(
    { value: 'R-9', mode: 'auto' },
    { looksLikeCode: alwaysCode, resolveCode },
  );
  assert.equal(res?.rows.length, 2);
  assert.equal(res?.pick?.id, 2);
});

test('not_found / null code → null (fall through)', async () => {
  const nf = fakeResolve({ kind: 'not_found', query: 'X' });
  assert.equal(
    await resolveInternalCode({ value: 'X', mode: 'auto' }, { looksLikeCode: alwaysCode, resolveCode: nf.resolveCode }),
    null,
  );
  const none = fakeResolve(null);
  assert.equal(
    await resolveInternalCode({ value: 'X', mode: 'auto' }, { looksLikeCode: alwaysCode, resolveCode: none.resolveCode }),
    null,
  );
});

test('dedupes PO ids across rows', async () => {
  const a = row({ id: 1, receiving_id: 5, zoho_purchaseorder_id: ' P1 ' });
  const b = row({ id: 2, receiving_id: 5, zoho_purchaseorder_id: 'P1' });
  const c = row({ id: 3, receiving_id: 5, zoho_purchaseorder_id: 'P2' });
  const { resolveCode } = fakeResolve({ kind: 'multi', rows: [a, b, c], receivingId: 5, via: 'po' });
  const res = await resolveInternalCode(
    { value: 'R-5', mode: 'auto' },
    { looksLikeCode: alwaysCode, resolveCode },
  );
  assert.deepEqual(res?.poIds, ['P1', 'P2']);
});
