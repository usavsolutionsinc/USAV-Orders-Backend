import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveCartonReadiness } from './carton-readiness';

test('awaiting_scan when no tracking_scanned_at', () => {
  const r = deriveCartonReadiness({ tracking_scanned_at: null, unboxed_at: null, received_at: null });
  assert.equal(r.stage, 'awaiting_scan');
  assert.equal(r.cta, 'none');
  assert.equal(r.pipelineStates.scanned, 'active');
  assert.equal(r.pipelineStates.unboxed, 'pending');
  assert.equal(r.pipelineStates.received, 'pending');
});

test('awaiting_unbox chooses match_po when scanned but no lines', () => {
  const r = deriveCartonReadiness(
    { tracking_scanned_at: '2026-07-06T00:00:00Z', unboxed_at: null, received_at: null },
    [],
  );
  assert.equal(r.stage, 'awaiting_unbox');
  assert.equal(r.cta, 'match_po');
  assert.equal(r.pipelineStates.scanned, 'done');
  assert.equal(r.pipelineStates.unboxed, 'active');
});

test('awaiting_unbox chooses continue_unbox when scanned and has lines', () => {
  const r = deriveCartonReadiness(
    { tracking_scanned_at: '2026-07-06T00:00:00Z', unboxed_at: null, received_at: null },
    [{ quantity_expected: 1, quantity_received: 0, workflow_status: 'ARRIVED' }],
  );
  assert.equal(r.stage, 'awaiting_unbox');
  assert.equal(r.cta, 'continue_unbox');
});

test('awaiting_receive after unboxed but before received', () => {
  const r = deriveCartonReadiness(
    { tracking_scanned_at: '2026-07-06T00:00:00Z', unboxed_at: '2026-07-06T01:00:00Z', received_at: null },
    [{ quantity_expected: 2, quantity_received: 1, workflow_status: 'UNBOXED' }],
  );
  assert.equal(r.stage, 'awaiting_receive');
  assert.equal(r.cta, 'continue_unbox');
  assert.equal(r.pipelineStates.unboxed, 'done');
  assert.equal(r.pipelineStates.received, 'active');
});

test('lines_in_progress when carton received but not all lines complete', () => {
  const r = deriveCartonReadiness(
    { tracking_scanned_at: '2026-07-06T00:00:00Z', unboxed_at: '2026-07-06T01:00:00Z', received_at: '2026-07-06T02:00:00Z' },
    [
      { quantity_expected: 2, quantity_received: 2, workflow_status: 'DONE' },
      { quantity_expected: 1, quantity_received: 0, workflow_status: 'UNBOXED' },
    ],
  );
  assert.equal(r.stage, 'lines_in_progress');
  assert.equal(r.cta, 'none');
  assert.equal(r.lineCount, 2);
  assert.equal(r.linesComplete, 1);
  assert.equal(r.pipelineStates.received, 'done');
});

test('carton_received when carton received and all lines complete', () => {
  const r = deriveCartonReadiness(
    { tracking_scanned_at: '2026-07-06T00:00:00Z', unboxed_at: '2026-07-06T01:00:00Z', received_at: '2026-07-06T02:00:00Z' },
    [
      { quantity_expected: 2, quantity_received: 2, workflow_status: 'DONE' },
      { quantity_expected: 1, quantity_received: 1, workflow_status: 'DONE' },
    ],
  );
  assert.equal(r.stage, 'carton_received');
  assert.equal(r.cta, 'none');
  assert.equal(r.pillTone, 'emerald');
});

