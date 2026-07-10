import test from 'node:test';
import assert from 'node:assert/strict';
import { recordActivationEvent, type ActivationEventDeps } from './activation-events';
import type { RecordOpsEventInput } from '@/lib/ops-events';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = '00000000-0000-4000-8000-000000000001' as OrgId;

function fakes(fail = false) {
  const cap: { written: RecordOpsEventInput[] } = { written: [] };
  const deps: ActivationEventDeps = {
    recordOpsEvent: async (input) => {
      if (fail) throw new Error('db down');
      cap.written.push(input);
    },
  };
  return { deps, cap };
}

test('recordActivationEvent: writes an activation.* ops event, org-scoped', async () => {
  const { deps, cap } = fakes();
  await recordActivationEvent(ORG, 'first_integration_connected', {
    actorStaffId: 7,
    clientEventId: 'evt-1',
    payload: { provider: 'ebay' },
  }, deps);

  assert.equal(cap.written.length, 1);
  const w = cap.written[0];
  assert.equal(w.organizationId, ORG);            // org from args, never defaulted
  assert.equal(w.entityType, 'other');            // org-level event: no entity anchor
  assert.equal(w.entityId, 0);
  assert.equal(w.eventType, 'activation.first_integration_connected');
  assert.equal(w.actorStaffId, 7);
  assert.equal(w.clientEventId, 'evt-1');         // idempotency key threaded through
  assert.deepEqual(w.payload, { provider: 'ebay' });
});

test('recordActivationEvent: opts default to null actor / null clientEventId / {} payload', async () => {
  const { deps, cap } = fakes();
  await recordActivationEvent(ORG, 'onboarding_started', {}, deps);
  const w = cap.written[0];
  assert.equal(w.actorStaffId, null);
  assert.equal(w.clientEventId, null);
  assert.deepEqual(w.payload, {});
});

test('recordActivationEvent: is no-op-safe — a failing write never throws', async () => {
  const { deps } = fakes(true);
  await assert.doesNotReject(recordActivationEvent(ORG, 'first_order_synced', {}, deps));
});
