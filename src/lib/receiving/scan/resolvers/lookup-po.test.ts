/**
 * Unit test for the lookup-po fetch-ladder resolver — DB/React-free.
 *
 * Run: `tsx --test src/lib/receiving/scan/resolvers/lookup-po.test.ts`
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveViaLookupPo } from './lookup-po';
import type { LookupPoData, LookupPoRequest } from '../types';

/** A lookupPo dep that returns queued responses and records call bodies + loader hits. */
function harness(responses: LookupPoData[]) {
  const bodies: LookupPoRequest[] = [];
  let i = 0;
  const loader = { count: 0 };
  return {
    deps: {
      lookupPo: async (body: LookupPoRequest) => {
        bodies.push(body);
        return responses[i++] ?? {};
      },
      showLoader: () => {
        loader.count += 1;
      },
    },
    bodies,
    loader,
  };
}

const input = (over: Partial<Parameters<typeof resolveViaLookupPo>[0]> = {}) => ({
  callValue: 'T1',
  callMode: 'tracking' as const,
  originalMode: 'tracking' as const,
  staffId: 1,
  ...over,
});

test('phase-1 match → matched, localOnly:true, no loader', async () => {
  const h = harness([{ success: true, matched: true, lines: [{}] }]);
  const res = await resolveViaLookupPo(input(), h.deps);
  assert.equal(res.kind, 'matched');
  assert.equal(h.bodies[0].localOnly, true);
  assert.equal(h.loader.count, 0);
});

test('!success → throws', async () => {
  const h = harness([{ success: false, error: 'boom' }]);
  await assert.rejects(() => resolveViaLookupPo(input(), h.deps), /boom/);
});

test('zoho_not_connected → integration-error', async () => {
  const h = harness([{ success: true, integration_error: 'zoho_not_connected', po_ids: ['P1'] }]);
  const res = await resolveViaLookupPo(input(), h.deps);
  assert.equal(res.kind, 'integration-error');
});

test('tracking miss (carton created, no not_found) → unmatched, no escalation', async () => {
  const h = harness([{ success: true, matched: false, receiving_id: 5 }]);
  const res = await resolveViaLookupPo(input(), h.deps);
  assert.equal(res.kind, 'unmatched');
  assert.equal(h.bodies.length, 1); // never escalated to Zoho
  assert.equal(h.loader.count, 0);
});

test('order miss → escalates to Zoho (loader shown); still nothing → not_found', async () => {
  const h = harness([
    { success: true, not_found: true, zoho_pending: true }, // phase 1
    { success: true, not_found: true }, // phase 2 still empty
  ]);
  const res = await resolveViaLookupPo(input({ callMode: 'order', originalMode: 'order' }), h.deps);
  assert.equal(res.kind, 'not_found');
  assert.equal(h.bodies.length, 2);
  assert.equal(h.bodies[1].localOnly, undefined); // phase 2 omits localOnly
  assert.equal(h.loader.count, 1);
});

test('order miss → Zoho now resolves the PO → matched', async () => {
  const h = harness([
    { success: true, not_found: true, zoho_pending: true },
    { success: true, matched: true, lines: [{}, {}] },
  ]);
  const res = await resolveViaLookupPo(input({ callMode: 'order', originalMode: 'order' }), h.deps);
  assert.equal(res.kind, 'matched');
  assert.equal(h.loader.count, 1);
});

test('auto miss with zoho_pending → does NOT escalate to Zoho (falls through to tracking on server)', async () => {
  const h = harness([{ success: true, matched: false, not_found: true, zoho_pending: true }]);
  const res = await resolveViaLookupPo(input({ callMode: 'auto', originalMode: 'auto' }), h.deps);
  assert.equal(res.kind, 'not_found');
  assert.equal(h.bodies.length, 1);
  assert.equal(h.loader.count, 0);
});

test('auto miss reported not_found (no carton) → not_found', async () => {
  const h = harness([{ success: true, matched: false, not_found: true }]);
  const res = await resolveViaLookupPo(input({ callMode: 'auto', originalMode: 'auto' }), h.deps);
  assert.equal(res.kind, 'not_found');
});
