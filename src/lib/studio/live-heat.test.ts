/**
 * Live-lens node heat — unit tests.
 * Run: npx tsx --test src/lib/studio/live-heat.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNodeHeat, WARM_SLA_RATIO } from './live-heat';

test('empty node is idle, with null slaRatio when no age', () => {
  const h = computeNodeHeat({ total: 0, error: 0, ageHours: null, slaHours: 4 });
  assert.equal(h.level, 'idle');
  assert.equal(h.slaRatio, null);
});

test('items present, no SLA configured → active (can\'t be "late")', () => {
  const h = computeNodeHeat({ total: 7, error: 0, ageHours: 100, slaHours: null });
  assert.equal(h.level, 'active');
  assert.equal(h.slaRatio, null);
});

test('oldest below 75% of SLA → active', () => {
  const h = computeNodeHeat({ total: 3, error: 0, ageHours: 2, slaHours: 4 }); // ratio 0.5
  assert.equal(h.level, 'active');
});

test('oldest at the warm threshold → warm', () => {
  const h = computeNodeHeat({ total: 3, error: 0, ageHours: WARM_SLA_RATIO * 4, slaHours: 4 });
  assert.equal(h.level, 'warm');
  assert.equal(h.reasons.includes('approaching SLA'), true);
});

test('oldest at/over SLA → hot', () => {
  const at = computeNodeHeat({ total: 2, error: 0, ageHours: 4, slaHours: 4 }); // ratio 1.0
  assert.equal(at.level, 'hot');
  const over = computeNodeHeat({ total: 2, error: 0, ageHours: 9, slaHours: 4 });
  assert.equal(over.level, 'hot');
  assert.equal(over.reasons.includes('over SLA'), true);
});

test('errors make a node hot even when nothing is queued (total 0)', () => {
  const h = computeNodeHeat({ total: 0, error: 3, ageHours: null, slaHours: null });
  assert.equal(h.level, 'hot');
  assert.equal(h.reasons.includes('3 in error'), true);
});

test('errors take precedence over an otherwise-healthy queue', () => {
  const h = computeNodeHeat({ total: 5, error: 1, ageHours: 1, slaHours: 8 }); // ratio 0.125
  assert.equal(h.level, 'hot');
});

test('slaRatio is reported even for an active node', () => {
  const h = computeNodeHeat({ total: 3, error: 0, ageHours: 1, slaHours: 4 });
  assert.equal(h.slaRatio, 0.25);
  assert.equal(h.level, 'active');
});
