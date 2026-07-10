import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPackTier, DEFAULT_TIER_MINUTES } from './pack-tier-classifier';

test('classifyPackTier: LARGE for home theater / lifestyle keywords', () => {
  const r = classifyPackTier({ productTitle: 'Bose Lifestyle V35 Home Theater System' });
  assert.equal(r.packTier, 'LARGE');
  assert.equal(r.estimatedMinutes, DEFAULT_TIER_MINUTES.LARGE);
});

test('classifyPackTier: LARGE for CineMate and Acoustimass', () => {
  assert.equal(classifyPackTier({ productTitle: 'Bose CineMate 15' }).packTier, 'LARGE');
  assert.equal(classifyPackTier({ productTitle: 'Bose Acoustimass 10 Series V' }).packTier, 'LARGE');
});

test('classifyPackTier: MEDIUM for wave / console / sounddock keywords', () => {
  const r = classifyPackTier({ productTitle: 'Bose Wave Radio IV' });
  assert.equal(r.packTier, 'MEDIUM');
  assert.equal(r.estimatedMinutes, DEFAULT_TIER_MINUTES.MEDIUM);

  assert.equal(classifyPackTier({ productTitle: 'Bose SoundDock Series II' }).packTier, 'MEDIUM');
  assert.equal(classifyPackTier({ productTitle: 'Bose EQ Unit' }).packTier, 'MEDIUM');
});

test('classifyPackTier: SMALL for pack-and-label parts', () => {
  assert.equal(classifyPackTier({ productTitle: 'PCB Board Assembly' }).packTier, 'SMALL');
  assert.equal(classifyPackTier({ productTitle: 'Bluetooth Audio Adapter' }).packTier, 'SMALL');
  assert.equal(classifyPackTier({ productTitle: 'Replacement Power Cable' }).packTier, 'SMALL');
  assert.equal(classifyPackTier({ productTitle: 'Small Accessory Kit' }).packTier, 'SMALL');
  assert.equal(classifyPackTier({ productTitle: 'Bose Remote Control (new)' }).packTier, 'SMALL');
});

test('classifyPackTier: unknown generic SKU defaults to SMALL not MEDIUM', () => {
  const r = classifyPackTier({ productTitle: 'Unknown Product Name' });
  assert.equal(r.packTier, 'SMALL');
  assert.equal(r.rule, 'DEFAULT_SMALL');
});

test('classifyPackTier: system-ish unknown title defaults to MEDIUM', () => {
  const r = classifyPackTier({ productTitle: 'Generic Stereo Unit' });
  assert.equal(r.packTier, 'MEDIUM');
  assert.equal(r.rule, 'DEFAULT_MEDIUM');
});
