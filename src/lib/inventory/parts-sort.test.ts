/**
 * Guards for the Parts auto-sort.
 *
 * 1. The committed-status predicate must protect units that are promised to an
 *    order or already shipped — auto-sort must never yank those into the parts
 *    bin. Early-lifecycle units (RECEIVED/TESTED/STOCKED/etc.) are eligible.
 * 2. The grade endpoint must actually invoke the sort on a PARTS grade.
 */

import { test } from 'node:test';
import { ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isCommittedForPartsSort } from './parts-sort';

test('committed/terminal statuses are protected from auto-sort', () => {
  for (const s of ['ALLOCATED', 'PICKED', 'PACKED', 'LABELED', 'STAGED', 'SHIPPED', 'SCRAPPED', 'RMA']) {
    ok(isCommittedForPartsSort(s), `${s} must block auto-sort`);
    ok(isCommittedForPartsSort(s.toLowerCase()), `${s} must block regardless of case`);
  }
});

test('early-lifecycle statuses are eligible for auto-sort', () => {
  for (const s of ['UNKNOWN', 'RECEIVED', 'IN_TEST', 'TESTED', 'GRADED', 'STOCKED', 'ON_HOLD', '', null]) {
    ok(!isCommittedForPartsSort(s), `${s} must NOT block auto-sort`);
  }
});

test('grade endpoint invokes parts auto-sort on a PARTS grade', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../../app/api/serial-units/[id]/grade/route.ts', import.meta.url)),
    'utf8',
  );
  ok(/sortSerialUnitToParts/.test(src), 'grade route must call sortSerialUnitToParts');
  ok(/newGrade === 'PARTS'/.test(src), "grade route must gate the sort on newGrade === 'PARTS'");
});
