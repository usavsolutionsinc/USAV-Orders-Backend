import test from 'node:test';
import assert from 'node:assert/strict';
import { stationActivityToTimeline, type StationActivityRow } from './station-activity-events';

function row(overrides: Partial<StationActivityRow> = {}): StationActivityRow {
  return {
    id: 1,
    created_at: '2026-06-15T12:00:00.000Z',
    station: 'TECH',
    activity_type: 'SERIAL_ADDED',
    actor_name: 'Technician',
    scan_ref: null,
    ...overrides,
  };
}

test('serial-added events use the linked serial number as a serial CopyChip ref', () => {
  const [item] = stationActivityToTimeline([
    row({
      tech_serial_number_id: 44,
      serial_number: 'SN-12345678',
      serial_type: 'SERIAL',
      metadata: { source_method: 'SCAN' },
    }),
  ]);

  assert.deepEqual(item.ref, { value: 'SN-12345678', kind: 'serial' });
  assert.equal(item.subtitle, 'Scanned serial');
});

test('legacy serial-added events fall back to metadata and describe SKU pulls', () => {
  const [item] = stationActivityToTimeline([
    row({
      metadata: {
        serial: 'LEGACY-9988',
        source_method: 'SKU_PULL',
        source_sku_code: 'SKU:BOSE-700',
      },
    }),
  ]);

  assert.deepEqual(item.ref, { value: 'LEGACY-9988', kind: 'serial' });
  assert.equal(item.subtitle, 'Added from SKU SKU:BOSE-700');
});

test('tracking scans continue to render tracking refs', () => {
  const [item] = stationActivityToTimeline([
    row({
      activity_type: 'TRACKING_SCANNED',
      scan_ref: '1Z9999999999999999',
    }),
  ]);

  assert.deepEqual(item.ref, { value: '1Z9999999999999999', kind: 'tracking' });
  assert.equal(item.subtitle, undefined);
});
