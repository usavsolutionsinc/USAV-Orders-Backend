/**
 * Unit test for the local-first tracking resolver — DB/React-free.
 *
 * Run: `tsx --test src/lib/receiving/scan/resolvers/local-tracking.test.ts`
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocalTracking } from './local-tracking';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

function row(p: Partial<ReceivingLineRow>): ReceivingLineRow {
  return {
    id: 1,
    receiving_id: null,
    tracking_number: null,
    zoho_purchaseorder_id: null,
    zoho_purchaseorder_number: null,
    quantity_received: 0,
    quantity_expected: null,
    ...p,
  } as unknown as ReceivingLineRow;
}

const deps = (rows: ReceivingLineRow[]) => ({ fetchLinesByTracking: async () => rows });

test('order mode → null without fetching', async () => {
  let called = false;
  const res = await resolveLocalTracking(
    { value: 'PO1', mode: 'order' },
    { fetchLinesByTracking: async () => { called = true; return []; } },
  );
  assert.equal(res, null);
  assert.equal(called, false);
});

test('local rows present → local-matched, prefers OPEN line', async () => {
  const full = row({ id: 1, receiving_id: 9, quantity_expected: 2, quantity_received: 2, zoho_purchaseorder_id: 'P1' });
  const open = row({ id: 2, receiving_id: 9, quantity_expected: 2, quantity_received: 1, zoho_purchaseorder_id: 'P1' });
  const res = await resolveLocalTracking({ value: 'T', mode: 'tracking' }, deps([full, open]));
  assert.equal(res?.kind, 'local-matched');
  assert.equal(res?.kind === 'local-matched' && res.receivingId, 9);
  assert.equal(res?.kind === 'local-matched' && res.pick.id, 2);
  assert.deepEqual(res?.kind === 'local-matched' ? res.poIds : null, ['P1']);
});

test('no local carton + exactly one incoming PO → retarget to order mode', async () => {
  const expected = row({ receiving_id: null, zoho_purchaseorder_number: 'PO-7' });
  const res = await resolveLocalTracking({ value: 'T', mode: 'auto' }, deps([expected]));
  assert.equal(res?.kind, 'retarget');
  assert.equal(res?.kind === 'retarget' && res.mode, 'order');
  assert.equal(res?.kind === 'retarget' && res.value, 'PO-7');
});

test('no local carton + multiple incoming POs → null (needs Zoho path)', async () => {
  const a = row({ receiving_id: null, zoho_purchaseorder_number: 'PO-1' });
  const b = row({ receiving_id: null, zoho_purchaseorder_number: 'PO-2' });
  const res = await resolveLocalTracking({ value: 'T', mode: 'auto' }, deps([a, b]));
  assert.equal(res, null);
});

test('nothing at all → null', async () => {
  const res = await resolveLocalTracking({ value: 'T', mode: 'tracking' }, deps([]));
  assert.equal(res, null);
});
