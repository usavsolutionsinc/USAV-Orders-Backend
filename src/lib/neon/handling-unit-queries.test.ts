/**
 * DB-free unit tests for the pure handling-unit (LPN) rollup derivation
 * (docs/handling-unit-lpn-plan.md "(+ tests)"). `rollupMembers` is the single
 * source of truth for the box's tested/untested counts and the status the
 * membership IMPLIES — `refreshHandlingUnitStatus` persists whatever this returns.
 *
 * Invariants under test:
 *  - UNTESTED = {UNKNOWN, RECEIVED} only; every other lifecycle state counts as
 *    tested (case-insensitive).
 *  - derived_status: empty → null (caller keeps stored), none-tested → OPEN,
 *    some-tested → IN_TEST, all-tested → CLOSED. STAGED is never derived here.
 */

import { test } from 'node:test';
import { equal, deepEqual } from 'node:assert';
import { rollupMembers, type HandlingUnitMember } from './handling-unit-queries';

function member(
  current_status: string,
  overrides: Partial<HandlingUnitMember> = {},
): HandlingUnitMember {
  return {
    id: 1,
    serial_number: 'SN',
    unit_uid: null,
    sku: null,
    sku_catalog_id: null,
    current_status,
    current_location: null,
    condition_grade: null,
    origin_receiving_line_id: null,
    ...overrides,
  };
}

test('rollupMembers: an empty box derives null (caller keeps the stored status)', () => {
  deepEqual(rollupMembers([]), { total: 0, tested: 0, untested: 0, derived_status: null });
});

test('rollupMembers: all-untested members → OPEN', () => {
  const r = rollupMembers([member('RECEIVED'), member('UNKNOWN'), member('RECEIVED')]);
  equal(r.total, 3);
  equal(r.tested, 0);
  equal(r.untested, 3);
  equal(r.derived_status, 'OPEN');
});

test('rollupMembers: a partially-tested box → IN_TEST', () => {
  const r = rollupMembers([member('RECEIVED'), member('TESTED')]);
  equal(r.tested, 1);
  equal(r.untested, 1);
  equal(r.derived_status, 'IN_TEST');
});

test('rollupMembers: every member past intake → CLOSED', () => {
  const r = rollupMembers([member('TESTED'), member('STOCKED'), member('SHIPPED')]);
  equal(r.tested, 3);
  equal(r.untested, 0);
  equal(r.derived_status, 'CLOSED');
});

test('rollupMembers: status comparison is case-insensitive', () => {
  // lower-case "received" must still count as untested (toUpperCase normalize).
  const r = rollupMembers([member('received'), member('Tested')]);
  equal(r.untested, 1);
  equal(r.tested, 1);
  equal(r.derived_status, 'IN_TEST');
});
