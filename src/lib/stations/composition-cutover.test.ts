/**
 * Verifies the Pack + Test surface compositions (operator-surfaces refactor
 * Phase 13) are registry-valid — every block/source/field is registered and
 * slot-compatible, so validateStationConfig passes and publish would accept
 * them. Pure / DB-free; mirrors the shapes the seed migrations use.
 *
 * These compositions are DORMANT: the SurfaceGate on `/pack` + `/test` renders
 * them ONLY when an active station_definitions row exists AND the per-org
 * `surface_composed_render` flag is on (default OFF). This test proves the
 * *capability* is publishable, not that any org has opted in.
 *   node --import tsx --test src/lib/stations/composition-cutover.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { StationConfig } from './contract';
import { validateStationConfig } from './validate';
import { getBlock, getDataSource } from './index';

// Test surface — scan bench + the units-awaiting-test queue.
const TEST_COMPOSITION: StationConfig = {
  slots: {
    trigger: [
      {
        id: 'blk_test_scan',
        block: 'scan_band',
        display: { surface: 'test', placeholder: 'Scan a serial, tracking, or order…' },
      },
    ],
    queue: [
      {
        id: 'blk_test_queue',
        block: 'rail_feed',
        source: {
          id: 'testing.tech_queue',
          filters: {},
          fields: { title: 'title', ref: 'tracking_number', meta: 'queue_kind' },
        },
        display: { empty_text: 'No units awaiting test.', show_count: true },
      },
    ],
  },
};

// Pack surface — scan-driven (scan an order to pack it). No queue block yet: the
// packing flow is scan-and-go and has no purpose-built "awaiting pack" queue
// endpoint to wrap (see the Phase 13 status note). scan_band needs no source.
const PACK_COMPOSITION: StationConfig = {
  slots: {
    trigger: [
      {
        id: 'blk_pack_scan',
        block: 'scan_band',
        display: { surface: 'pack', placeholder: 'Scan an order to pack…' },
      },
    ],
  },
};

test('the testing queue data source + generic blocks are registered', () => {
  assert.ok(getBlock('scan_band'), 'scan_band block registered');
  assert.ok(getBlock('rail_feed'), 'rail_feed block registered');
  assert.ok(getDataSource('testing.tech_queue'), 'testing.tech_queue source registered');
  // scan_band exposes a surface policy the composition selects (pack/test/…).
  const surfaceField = getBlock('scan_band')!.configSchema?.find((f) => f.key === 'surface');
  assert.ok(surfaceField, 'scan_band declares a surface config field');
  const opts = new Set((surfaceField!.options ?? []).map((o) => o.value));
  assert.ok(opts.has('test') && opts.has('pack'), 'surface options include test + pack');
});

test('the Test surface composition validates with zero issues', () => {
  const issues = validateStationConfig(TEST_COMPOSITION);
  assert.deepEqual(issues, [], `expected no issues, got: ${JSON.stringify(issues)}`);
});

test('the Pack surface composition (scan-only) validates with zero issues', () => {
  const issues = validateStationConfig(PACK_COMPOSITION);
  assert.deepEqual(issues, [], `expected no issues, got: ${JSON.stringify(issues)}`);
});

test('rail_feed field roles map only to declared testing.tech_queue fields', () => {
  const source = getDataSource('testing.tech_queue')!;
  const declared = new Set(source.shape.map((f) => f.key));
  for (const fieldKey of ['title', 'tracking_number', 'queue_kind']) {
    assert.ok(declared.has(fieldKey), `source must declare "${fieldKey}"`);
  }
});
