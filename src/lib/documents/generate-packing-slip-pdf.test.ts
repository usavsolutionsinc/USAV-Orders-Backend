import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePackingSlipPdf } from './generate-packing-slip-pdf';

test('generatePackingSlipPdf returns a valid PDF header', () => {
  const buf = generatePackingSlipPdf({
    orderRef: 'ORD-100',
    platform: 'ebay',
    lines: [{ sku: 'SKU-1', title: 'Widget', quantity: '2' }],
    tracking: '1Z999',
  });
  assert.ok(buf.subarray(0, 5).toString('utf8').startsWith('%PDF-'));
  assert.ok(buf.length > 200);
});
