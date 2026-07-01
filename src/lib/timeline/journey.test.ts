import test from 'node:test';
import assert from 'node:assert/strict';
import { countRoundTrips } from './journey';
import type { TimelineItem } from './types';

function item(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 1,
    at: '2026-06-15T12:00:00.000Z',
    title: 'Event',
    ...overrides,
  };
}

test('countRoundTrips: no ship/return history yields zero/zero', () => {
  const result = countRoundTrips([item({ title: 'Received', sourceEventType: 'RECEIVED' })]);
  assert.deepEqual(result, { shippedCount: 0, returnedCount: 0 });
});

test('countRoundTrips: counts SHIPPED and RETURNED independently across a full round trip', () => {
  const items = [
    item({ id: 1, sourceEventType: 'RECEIVED' }),
    item({ id: 2, sourceEventType: 'SHIPPED' }),
    item({ id: 3, sourceEventType: 'RETURNED' }),
    item({ id: 4, sourceEventType: 'SHIPPED' }),
  ];
  assert.deepEqual(countRoundTrips(items), { shippedCount: 2, returnedCount: 1 });
});

test('countRoundTrips: keys off sourceEventType, not the display title', () => {
  // A different spine's item could coincidentally have a similar title
  // ("Shipped — scanned out" from orderAuditToTimeline) without ever setting
  // sourceEventType — must not be miscounted as a ship event.
  const items = [item({ title: 'Shipped — scanned out', sourceEventType: undefined })];
  assert.deepEqual(countRoundTrips(items), { shippedCount: 0, returnedCount: 0 });
});

test('countRoundTrips: empty input yields zero/zero', () => {
  assert.deepEqual(countRoundTrips([]), { shippedCount: 0, returnedCount: 0 });
});
