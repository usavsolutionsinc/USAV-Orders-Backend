import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/**
 * Guards scan-stable PO line meta chip order in PoLinesAccordion.
 *
 * Price is variable-width and optional — it must render last so qty · SKU ·
 * condition · serial columns align vertically across rows when operators
 * down-scan a multi-item PO.
 */
const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'PoLinesAccordion.tsx'),
  'utf8',
);

/** First render-site index for an exact JSX opening tag. */
function firstRenderIndex(tag: string): number {
  const re = new RegExp(`<${tag}(?:\\s|>|/)`);
  const importEnd = SRC.indexOf('export function') || SRC.indexOf('export default');
  const from = importEnd > -1 ? importEnd : 0;
  const slice = SRC.slice(from);
  const match = slice.match(re);
  assert.ok(match?.index != null, `${tag} render site missing`);
  return from + match.index;
}

test('PO line meta chips: condition and serial precede price', () => {
  const conditionIdx = firstRenderIndex('ConditionGradeChip');
  const serialIdx = firstRenderIndex('SerialChip');
  const priceIdx = firstRenderIndex('UnitPriceChip');

  assert.ok(conditionIdx < priceIdx, 'UnitPriceChip must follow ConditionGradeChip');
  assert.ok(serialIdx < priceIdx, 'UnitPriceChip must follow SerialChip');
});

test('PO line meta chips: SKU precedes condition (price no longer mid-row)', () => {
  const skuIdx = firstRenderIndex('SkuScanRefChip');
  const conditionIdx = firstRenderIndex('ConditionGradeChip');
  const priceIdx = firstRenderIndex('UnitPriceChip');

  assert.ok(skuIdx < conditionIdx, 'ConditionGradeChip must follow SkuScanRefChip');
  assert.ok(conditionIdx < priceIdx, 'UnitPriceChip must be last among identity chips');
});
