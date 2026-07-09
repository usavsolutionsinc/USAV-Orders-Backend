import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPackTier, DEFAULT_TIER_MINUTES } from './pack-tier-classifier';

test('classifyPackTier: LARGE for home theater / lifestyle keywords', () => {
  const r = classifyPackTier({ productTitle: 'Bose Lifestyle V35 Home Theater System' });
  assert.equal(r.packTier, 'LARGE');
  assert.equal(r.estimatedMinutes, DEFAULT_TIER_MINUTES.LARGE);
});

test('classifyPackTier: MEDIUM for wave / console keywords', () => {
  const r = classifyPackTier({ productTitle: 'Bose Wave Radio IV Console' });
  assert.equal(r.packTier, 'MEDIUM');
  assert.equal(r.estimatedMinutes, DEFAULT_TIER_MINUTES.MEDIUM);
});

test('classifyPackTier: SMALL for accessory keywords', () => {
  const r = classifyPackTier({ productTitle: 'Bose Remote Control (new)' });
  assert.equal(r.packTier, 'SMALL');
  assert.equal(r.estimatedMinutes, DEFAULT_TIER_MINUTES.SMALL);
});

test('classifyPackTier: defaults to MEDIUM', () => {
  const r = classifyPackTier({ productTitle: 'Unknown Product Name' });
  assert.equal(r.packTier, 'MEDIUM');
});

