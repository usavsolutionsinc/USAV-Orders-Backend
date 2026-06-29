import test from 'node:test';
import assert from 'node:assert/strict';
import { amendmentsToTimeline, type AmendmentTimelineRow } from './amendment-events';
import {
  substitutionReasonLabel,
  substitutionReasonTone,
  isBuiltInSubstitutionReason,
} from '@/lib/fulfillment/substitution-reasons';

const base: AmendmentTimelineRow = {
  id: 9,
  created_at: '2026-06-28T10:00:00Z',
  status: 'APPLIED',
  reason_code: 'CUSTOMER_REQUEST',
  customer_request_note: 'asked for white',
  original_sku: 'SKU-BLACK',
  original_condition: 'USED_A',
  fulfilled_sku: 'SKU-WHITE',
  fulfilled_condition: 'USED_B',
  substitute_serial: 'SN-12345',
  raised_by_name: 'Dana',
};

test('reasons: built-in codes resolve to label + tone; unknown prettifies', () => {
  assert.equal(substitutionReasonLabel('DAMAGE_FOUND'), 'Damage found');
  assert.equal(substitutionReasonTone('DAMAGE_FOUND'), 'danger');
  assert.equal(isBuiltInSubstitutionReason('DAMAGE_FOUND'), true);
  // Unknown / org-custom code: prettified label, muted tone, not built-in.
  assert.equal(substitutionReasonLabel('VIP_SWAP'), 'Vip swap');
  assert.equal(substitutionReasonTone('VIP_SWAP'), 'muted');
  assert.equal(isBuiltInSubstitutionReason('VIP_SWAP'), false);
});

test('adapter: maps an amendment to a TimelineItem with delta + badges', () => {
  const [item] = amendmentsToTimeline([base]);
  assert.equal(item.id, 'amendment-9');
  assert.equal(item.at, '2026-06-28T10:00:00Z');
  assert.equal(item.title, 'Unit substituted');
  assert.equal(item.tone, 'success'); // APPLIED
  assert.equal(item.subtitle, 'SKU-BLACK · USED_A → SKU-WHITE · USED_B — asked for white');
  assert.deepEqual(item.ref, { value: 'SN-12345', kind: 'serial' });
  assert.equal(item.actor, 'Dana');
  assert.deepEqual(item.badges, [
    { label: 'Customer request', tone: 'info' },
    { label: 'Applied', tone: 'success' },
  ]);
});

test('adapter: PENDING is warning-toned and labeled for the approval queue', () => {
  const [item] = amendmentsToTimeline([{ ...base, status: 'PENDING' }]);
  assert.equal(item.tone, 'warning');
  assert.deepEqual(item.badges?.[1], { label: 'Pending approval', tone: 'warning' });
});

test('adapter: REJECTED is danger-toned', () => {
  const [item] = amendmentsToTimeline([{ ...base, status: 'REJECTED' }]);
  assert.equal(item.tone, 'danger');
  assert.deepEqual(item.badges?.[1], { label: 'Rejected', tone: 'danger' });
});

test('adapter: no ref when there is no substitute serial; note-only subtitle', () => {
  const [item] = amendmentsToTimeline([
    { ...base, substitute_serial: null, original_sku: null, original_condition: null, fulfilled_sku: null, fulfilled_condition: null },
  ]);
  assert.equal(item.ref, undefined);
  assert.equal(item.subtitle, 'asked for white'); // delta omitted, note kept
});
