/**
 * Architectural-invariant guards for the serial sidecar.
 *
 * Serial numbers are sidecar metadata: attaching or detaching a serial must
 * NEVER touch the stock ledger or a line's received quantity. Stock and
 * quantity are owned exclusively by the PO line item via the Receive action
 * (receiveLineUnits). These source-level checks fail loudly if someone
 * re-couples the two concerns.
 */

import { test } from 'node:test';
import { ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const attachSrc = readFileSync(
  fileURLToPath(new URL('./serial-attach.ts', import.meta.url)),
  'utf8',
);
const scanSerialSrc = readFileSync(
  fileURLToPath(
    new URL('../../app/api/receiving/scan-serial/route.ts', import.meta.url),
  ),
  'utf8',
);

test('serial-attach never writes the stock ledger', () => {
  // Match an actual write target (INSERT INTO / UPDATE), not comment mentions.
  ok(
    !/(into|update)\s+sku_stock_ledger/i.test(attachSrc),
    'serial-attach.ts must not write sku_stock_ledger — stock is owned by the PO line item',
  );
});

test('serial-attach never mutates quantity_received', () => {
  ok(
    !/quantity_received\s*[=+]/.test(attachSrc),
    'serial-attach.ts must not change quantity_received — quantity is owned by the Receive action',
  );
});

test('scan-serial route routes through the sidecar, not the stock writer', () => {
  ok(
    !/receiveLineUnits/.test(scanSerialSrc),
    'scan-serial must use attachSerialToLine/detachSerialFromLine, not receiveLineUnits',
  );
  ok(
    /attachSerialToLine/.test(scanSerialSrc) &&
      /detachSerialFromLine/.test(scanSerialSrc),
    'scan-serial must use the decoupled serial CRUD helpers',
  );
});
