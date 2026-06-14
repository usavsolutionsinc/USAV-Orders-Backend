/**
 * Unit coverage for `looksLikeReceivingCode` — the synchronous predicate the
 * receiving scan bar uses to decide whether to run the canonical-code resolver
 * even when the dash auto-classify heuristic armed Order# mode.
 *
 * The contract that matters: every canonical internal handle (which all carry
 * a dash, so `classifyUnboxScan` would otherwise route them to the PO lookup)
 * returns true, while genuine PO / order / tracking values return false so
 * their existing lookup-po routing is left untouched.
 */

import { test } from 'node:test';
import { strictEqual } from 'node:assert';

import { looksLikeReceivingCode } from './resolve-testing-scan';

test('canonical handles are recognised as codes (resolve even in Order# mode)', () => {
  for (const v of [
    'R-1234',        // carton handle — the printed receiving label
    'r-7',           // case-insensitive
    'RCV-58',        // legacy carton string
    'H-12',          // handling-unit (LPN)
    'L-900',         // receiving line
    'U-451',         // serial unit
    'REP-33',        // repair label
    '00098-2621-000142', // printed unit-id {SKU}-{YYWW}-{SEQ6}
    'IPH13-128-2621-000142', // unit-id whose short SKU itself has a dash
  ]) {
    strictEqual(looksLikeReceivingCode(v), true, `${v} should be a code`);
  }
});

test('PO / order / tracking values are NOT codes (keep lookup-po routing)', () => {
  for (const v of [
    'PO-00123',                 // Zoho PO number
    '111-2222222-3333333',      // Amazon order number
    '1Z999AA10123456784',       // UPS tracking (no dash)
    '9400111899223456781234',   // USPS tracking
    'A-01-01-1',                // bin / location code
    '12345:HP-PSU',             // static SKU
    '',                         // empty
    '   ',                      // whitespace
  ]) {
    strictEqual(looksLikeReceivingCode(v), false, `${v} should NOT be a code`);
  }
});

test('surrounding whitespace is tolerated', () => {
  strictEqual(looksLikeReceivingCode('  R-1234  '), true);
  strictEqual(looksLikeReceivingCode('\tH-9\n'), true);
});
