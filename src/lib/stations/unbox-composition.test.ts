/**
 * Verifies the seeded Unbox surface composition (2026-07-05 migration) is
 * registry-valid — every block/source/field is registered and slot-compatible,
 * so validateStationConfig passes and publish would accept it. Pure / DB-free:
 * mirrors the migration's jsonb config exactly.
 *   node --import tsx --test src/lib/stations/unbox-composition.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { StationConfig } from './contract';
import { validateStationConfig } from './validate';
import { getBlock, getDataSource } from './index';

// Byte-for-byte mirror of 2026-07-05_seed_unbox_surface_composition.sql config.
const UNBOX_COMPOSITION: StationConfig = {
  slots: {
    trigger: [
      {
        id: 'blk_unbox_scan',
        block: 'scan_band',
        display: { surface: 'unbox', placeholder: 'Scan tracking, serial, or SKU…' },
      },
    ],
    queue: [
      {
        id: 'blk_unbox_queue',
        block: 'rail_feed',
        source: {
          id: 'receiving.unbox_queue',
          filters: { status: 'ARRIVED_MATCHED', limit: '100' },
          fields: { title: 'title', ref: 'tracking_number', meta: 'carrier' },
        },
        display: { empty_text: 'No cartons awaiting unbox.', show_count: true },
      },
    ],
  },
};

test('the new runtime blocks + source are registered', () => {
  assert.ok(getBlock('scan_band'), 'scan_band block registered');
  assert.ok(getBlock('rail_feed'), 'rail_feed block registered');
  assert.ok(getDataSource('receiving.unbox_queue'), 'receiving.unbox_queue source registered');
  assert.deepEqual(getBlock('scan_band')!.slots, ['trigger']);
  assert.deepEqual(getBlock('rail_feed')!.slots, ['queue']);
  assert.equal(getBlock('scan_band')!.accepts, 'none');
  assert.equal(getBlock('rail_feed')!.accepts, 'rows');
});

test('the seeded Unbox composition validates with zero issues', () => {
  const issues = validateStationConfig(UNBOX_COMPOSITION);
  assert.deepEqual(issues, [], `expected no issues, got: ${JSON.stringify(issues)}`);
});

test('rail_feed field roles map only to declared source fields', () => {
  const source = getDataSource('receiving.unbox_queue')!;
  const declared = new Set(source.shape.map((f) => f.key));
  for (const fieldKey of ['title', 'tracking_number', 'carrier']) {
    assert.ok(declared.has(fieldKey), `source must declare "${fieldKey}"`);
  }
});
