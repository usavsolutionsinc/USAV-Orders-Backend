/**
 * Pure tests for the entity_signals → TimelineItem adapter (Phase 5).
 * Run: npx tsx --test src/lib/timeline/entity-signals.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { entitySignalsToTimeline } from './entity-signals';

const base = {
  id: 1,
  occurred_at: '2026-07-03T10:00:00Z',
  entity_type: 'SERIAL_UNIT',
  entity_id: 501,
  reason_code: null,
  notes: null,
  severity: null,
};

test('entitySignalsToTimeline: maps kind→label/tone, entity→badge, reason+notes→subtitle', () => {
  const [item] = entitySignalsToTimeline([
    { ...base, signal_kind: 'test_fail_reason', reason_code: 'HDMI_DEAD', notes: 'no output on port 2' },
  ]);
  assert.equal(item.id, 'sig:1');
  assert.equal(item.title, 'Test failure');
  assert.equal(item.tone, 'danger');
  assert.equal(item.subtitle, 'HDMI_DEAD — no output on port 2');
  assert.deepEqual(item.badges, [{ label: 'Serial unit #501', tone: 'muted' }]);
  assert.equal(item.sourceEventType, 'test_fail_reason');
});

test('entitySignalsToTimeline: severity ≥ 2 escalates a warning tone to danger', () => {
  const [warn] = entitySignalsToTimeline([{ ...base, signal_kind: 'return_reason', severity: 1 }]);
  assert.equal(warn.tone, 'warning');
  const [esc] = entitySignalsToTimeline([{ ...base, signal_kind: 'return_reason', severity: 2 }]);
  assert.equal(esc.tone, 'danger');
});

test('entitySignalsToTimeline: unknown kind → prettified title + muted tone; no notes → no subtitle', () => {
  const [item] = entitySignalsToTimeline([{ ...base, signal_kind: 'some_new_kind' }]);
  assert.equal(item.title, 'Some new kind');
  assert.equal(item.tone, 'muted');
  assert.equal(item.subtitle, undefined);
});

test('entitySignalsToTimeline: unknown entity_type falls back to the raw value in the badge', () => {
  const [item] = entitySignalsToTimeline([{ ...base, entity_type: 'GADGET', signal_kind: 'buyer_note' }]);
  assert.deepEqual(item.badges, [{ label: 'GADGET #501', tone: 'muted' }]);
});
