/**
 * Round-trip guard for printed handles: every `*Handle()` factory must scan
 * back through `routeScan()` to the right entity type. This test is the
 * standing guard for the "if I can generate it I can scan it back" invariant —
 * if someone adds a new handle prefix without a matching `routeScan` branch,
 * the `every generated handle round-trips` test fails.
 */

import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';

import {
  routeScan,
  receivingHandle,
  receivingLineHandle,
  serialUnitHandle,
  handlingUnitHandle,
  repairHandle,
} from './barcode-routing';

test('every generated handle round-trips to its entity type (not bin/sku fallback)', () => {
  const cases: Array<[string, string]> = [
    [receivingHandle(42), 'receiving'],
    [receivingLineHandle(900), 'receiving-line'],
    [serialUnitHandle(451), 'serial-unit'],
    [handlingUnitHandle(12), 'handling-unit'],
    [repairHandle(33), 'receiving'], // repair routes via the mobile repair page
  ];
  for (const [payload, expectedType] of cases) {
    const r = routeScan(payload);
    ok(r, `${payload} should route`);
    strictEqual(r!.type, expectedType, `${payload} → type`);
  }
});

test('REP-{id} repair label scans back to the working /m/rs/{id} page (not the dead /repair/{id})', () => {
  const r = routeScan(repairHandle(33));
  strictEqual(r!.redirect, '/m/rs/33');
});

test('U- unit handle resolves an ALPHANUMERIC serial (regression: used to mis-route to /inventory)', () => {
  const phys = routeScan(serialUnitHandle('CN1A2B3'));
  strictEqual(phys!.type, 'serial-unit');
  strictEqual(phys!.redirect, '/m/u/CN1A2B3', 'prefix stripped, serial preserved');

  const numeric = routeScan(serialUnitHandle('451'));
  strictEqual(numeric!.redirect, '/m/u/451');

  // U- wrapping a minted unit_uid strips the prefix so the API resolves by unit_uid.
  const uid = routeScan(serialUnitHandle('00098-2621-000142'));
  strictEqual(uid!.type, 'serial-unit');
  strictEqual(uid!.redirect, '/m/u/00098-2621-000142');
});

test('zone-letter location codes are NOT swallowed by the broadened U- handle parser', () => {
  // U-zone bin/location codes must still classify as bins (the location guard).
  strictEqual(routeScan('U-01-02-3')!.type, 'bin');
  strictEqual(routeScan('U-01-02-3-04')!.type, 'bin');
  // A plain leading-letter bin is unaffected too.
  strictEqual(routeScan('A-01-01-1')!.type, 'bin');
});

test('bare minted unit-id (no prefix) still routes to the unit page', () => {
  const r = routeScan('00098-2621-000142');
  strictEqual(r!.type, 'serial-unit');
});
