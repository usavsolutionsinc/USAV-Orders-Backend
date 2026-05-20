/**
 * Parser tests — exercises the AI walker against the URL shapes we
 * expect to see in production (printed QRs + bare paths) plus a few
 * malformed inputs.
 */

import { test } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';

import { parseGs1DigitalLink } from './parser';

test('parses a full Digital Link URL with GTIN + serial', () => {
  const ctx = parseGs1DigitalLink(
    'https://usav-orders-backend.vercel.app/01/0614141000005/21/ABC123',
  );
  ok(ctx);
  strictEqual(ctx!.gtin, '0614141000005');
  strictEqual(ctx!.serial, 'ABC123');
  strictEqual(ctx!.aiMap['01'], '0614141000005');
  strictEqual(ctx!.aiMap['21'], 'ABC123');
});

test('parses a path-only Digital Link with batch + serial', () => {
  const ctx = parseGs1DigitalLink('/01/0614141000005/10/LOT5/21/SER1');
  ok(ctx);
  strictEqual(ctx!.gtin, '0614141000005');
  strictEqual(ctx!.batchOrLot, 'LOT5');
  strictEqual(ctx!.serial, 'SER1');
});

test('parses a location URL and upper-cases the code', () => {
  const ctx = parseGs1DigitalLink('/414/0614141000005/254/c0101101');
  ok(ctx);
  strictEqual(ctx!.gln, '0614141000005');
  strictEqual(ctx!.locationCode, 'C0101101');
});

test('captures unknown AIs in aiMap but leaves named fields blank', () => {
  const ctx = parseGs1DigitalLink('/99/foo/88/bar');
  ok(ctx);
  strictEqual(ctx!.aiMap['99'], 'foo');
  strictEqual(ctx!.aiMap['88'], 'bar');
  strictEqual(ctx!.gtin, undefined);
  strictEqual(ctx!.serial, undefined);
});

test('decodes URL-encoded AI values', () => {
  const ctx = parseGs1DigitalLink('/01/0614141000005/21/A%2FB%20C');
  ok(ctx);
  strictEqual(ctx!.serial, 'A/B C');
});

test('returns null for empty input', () => {
  strictEqual(parseGs1DigitalLink(''), null);
  strictEqual(parseGs1DigitalLink('   '), null);
});

test('returns null for input with no AI pairs', () => {
  strictEqual(parseGs1DigitalLink('not a url at all'), null);
  // No numeric AI segment anywhere.
  strictEqual(parseGs1DigitalLink('/inventory/locations'), null);
});

test('keeps rawUrl exactly as provided', () => {
  const raw = '/01/0614141000005';
  const ctx = parseGs1DigitalLink(raw);
  ok(ctx);
  strictEqual(ctx!.rawUrl, raw);
});

test('strips non-digit chars from GTIN', () => {
  // Some scanner wedges deliver the GTIN with stray separators. The
  // parser normalises to digits-only for the DB column.
  const ctx = parseGs1DigitalLink('/01/0614141-000005');
  ok(ctx);
  strictEqual(ctx!.gtin, '0614141000005');
});

test('aiMap shape is a plain Record<string,string>', () => {
  const ctx = parseGs1DigitalLink('/01/0614141000005/21/ABC');
  ok(ctx);
  deepStrictEqual(Object.keys(ctx!.aiMap).sort(), ['01', '21']);
});
