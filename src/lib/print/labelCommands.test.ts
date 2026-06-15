import assert from 'node:assert/strict';
import test from 'node:test';

import type { ReceivingLabelPayload } from '@/lib/print/printReceivingLabel';
import { resolvePaperSize } from '@/lib/print/browserPrint';
import {
  buildReceivingLabelCommands,
  packMonochromeBitmap,
} from '@/lib/print/labelCommands';

const payload: ReceivingLabelPayload = {
  receivingId: 1234,
  scanValue: 'PO-987654',
  platform: 'eBay',
  notes: 'Silent print geometry',
  conditionCode: 'NEW',
  receivingType: 'PO',
  date: '06/15/26',
};

test('TSPL receiving labels use exact 2x1 geometry at 203 DPI', () => {
  const commands = buildReceivingLabelCommands(payload, 'tspl', resolvePaperSize('2x1'));

  assert.match(commands, /^SIZE 50\.8 mm,25\.4 mm\r\n/);
  assert.match(commands, /\r\nGAP 3\.0 mm,0 mm\r\n/);
  assert.match(commands, /\r\nDIRECTION 1,0\r\nREFERENCE 0,0\r\n/);
  assert.match(commands, /\r\nDMATRIX 225,10,171,171,"R-1234"\r\n/);
  assert.match(commands, /\r\nPRINT 1,1\r\n$/);
  assert.equal(commands.includes('\n') && !commands.includes('\r\n'), false);
});

test('monochrome bitmap packing uses the CX418 inverse raster polarity', () => {
  const rgba = new Uint8ClampedArray([
    0, 0, 0, 255,
    255, 255, 255, 255,
    0, 0, 0, 255,
    255, 255, 255, 255,
    255, 255, 255, 255,
    255, 255, 255, 255,
    255, 255, 255, 255,
    0, 0, 0, 255,
  ]);

  assert.deepEqual([...packMonochromeBitmap(rgba, 8, 1)], [0x5e]);
});
