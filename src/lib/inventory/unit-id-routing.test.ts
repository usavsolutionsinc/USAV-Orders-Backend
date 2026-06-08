/**
 * Guards the contract between unit-id minting and scan routing: every id
 * `formatUnitId` produces must be classified by `routeScan` as a serial-unit
 * and routed to the unit page, so a scanned products-label QR (which now
 * encodes the bare unit id, not a GS1 link) resolves instead of 404'ing.
 *
 * If the format and the routing regex ever drift, these fail — pure, no DB.
 */

import { test } from 'node:test';
import { ok, equal, deepEqual } from 'node:assert';
import { formatUnitId, parseUnitId } from './unit-id-format';
import { routeScan } from '../barcode-routing';

const CASES = [
  { short: '00098', isoYear: 2026, isoWeek: 21, seq: 142 }, // numeric SKU
  { short: 'IPH13-128-BLU', isoYear: 2026, isoWeek: 1, seq: 1 }, // dashed short SKU
  { short: 'WIDGET', isoYear: 2030, isoWeek: 53, seq: 999999 }, // max-ish
];

test('formatUnitId output routes to the unit page', () => {
  for (const c of CASES) {
    const id = formatUnitId(c.short, c.isoYear, c.isoWeek, c.seq);
    const route = routeScan(id);
    ok(route, `routeScan returned null for ${id}`);
    equal(route!.type, 'serial-unit', `${id} should be a serial-unit`);
    equal(route!.redirect, `/m/u/${encodeURIComponent(id)}`);
  }
});

test('parseUnitId round-trips formatUnitId', () => {
  const id = formatUnitId('IPH13-128-BLU', 2026, 21, 142);
  deepEqual(parseUnitId(id), { baseSku: 'IPH13-128-BLU', yyww: '2621', seq: 142 });
});

test('routeScan does not misclassify location/bin codes as serial-units', () => {
  // Dashed location codes end in a 1-2 digit tail, never a 6-digit seq.
  equal(routeScan('A-01-01-1')?.type, 'bin');
  equal(routeScan('A-01-01-1-01')?.type, 'bin');
  // Bare bin fallback (letter prefix, no unit-id tail).
  equal(routeScan('A12')?.type, 'bin');
});
