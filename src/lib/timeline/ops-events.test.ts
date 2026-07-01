import test from 'node:test';
import assert from 'node:assert/strict';
import { opsEventsToTimeline, type OpsEventRow } from './ops-events';

function row(overrides: Partial<OpsEventRow> = {}): OpsEventRow {
  return {
    id: 1,
    occurred_at: '2026-06-15T12:00:00.000Z',
    event_type: 'UNBOX_CONFIRMED',
    entity_type: 'receiving',
    entity_id: 42,
    ...overrides,
  };
}

test('mapped event types get their curated title + tone', () => {
  const [item] = opsEventsToTimeline([row({ event_type: 'TRACKING_SCANNED' })]);
  assert.equal(item.title, 'Tracking scanned');
  assert.equal(item.tone, 'info');
});

test('unmapped event types fall back to a prettified label + muted tone', () => {
  const [item] = opsEventsToTimeline([row({ event_type: 'SOME_NEW_EVENT' })]);
  assert.equal(item.title, 'Some new event');
  assert.equal(item.tone, 'muted');
});

test('sourceEventType carries the raw event_type for callers that need a stable key', () => {
  const [item] = opsEventsToTimeline([row({ event_type: 'UNBOX_CONFIRMED' })]);
  assert.equal(item.sourceEventType, 'UNBOX_CONFIRMED');
});

test('actor is undefined when the row has no resolved actor_name', () => {
  const [item] = opsEventsToTimeline([row()]);
  assert.equal(item.actor, undefined);
});

test('actor passes through when the row does carry a resolved actor_name', () => {
  const [item] = opsEventsToTimeline([row({ actor_name: 'Jordan' })]);
  assert.equal(item.actor, 'Jordan');
});

test('id is namespaced with the ops: prefix', () => {
  const [item] = opsEventsToTimeline([row({ id: 7 })]);
  assert.equal(item.id, 'ops:7');
});
