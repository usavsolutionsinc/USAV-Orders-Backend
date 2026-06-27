import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LABEL_COLOR_TOKENS,
  DEFAULT_LABEL_COLOR,
  isLabelColorToken,
  normalizeLabelColor,
  labelChipClasses,
  LABEL_CHIP_CLASSES,
} from '@/lib/photos/label-colors';

test('isLabelColorToken accepts known tokens and rejects everything else', () => {
  assert.equal(isLabelColorToken('blue'), true);
  assert.equal(isLabelColorToken('rose'), true);
  assert.equal(isLabelColorToken('#ff0000'), false, 'a hex is not a token');
  assert.equal(isLabelColorToken('chartreuse'), false);
  assert.equal(isLabelColorToken(null), false);
  assert.equal(isLabelColorToken(undefined), false);
  assert.equal(isLabelColorToken(42), false);
});

test('normalizeLabelColor coerces unknown/empty values to the default', () => {
  assert.equal(normalizeLabelColor('emerald'), 'emerald');
  assert.equal(normalizeLabelColor('#abc'), DEFAULT_LABEL_COLOR);
  assert.equal(normalizeLabelColor(null), DEFAULT_LABEL_COLOR);
});

test('every token has a full literal chip class string (Tailwind-scannable)', () => {
  for (const token of LABEL_COLOR_TOKENS) {
    const cls = LABEL_CHIP_CLASSES[token];
    assert.ok(cls.includes(`bg-${token}-50`), `${token} chip has its bg literal`);
    assert.ok(cls.includes(`text-${token}-700`), `${token} chip has its text literal`);
    assert.ok(cls.includes(`ring-${token}-200`), `${token} chip has its ring literal`);
  }
});

test('labelChipClasses falls back to the default token classes for a bad color', () => {
  assert.equal(labelChipClasses('not-a-token'), LABEL_CHIP_CLASSES[DEFAULT_LABEL_COLOR]);
});
