/**
 * DB-free validation tests for the handling-unit (LPN) CRUD request schemas
 * (docs/handling-unit-lpn-plan.md "(+ tests)"). These guard the Zod contract the
 * /api/handling-units routes validate against BEFORE any domain helper runs:
 *
 * 1. unitRefs — the shared operator-ref coercion: accepts ids / `U-{id}` /
 *    unit_uid / serial as numbers or strings, trims, enforces 1..500, and
 *    transforms every entry to a string so the resolver speaks one type.
 * 2. HandlingUnitCreateBody — all-optional mint body; `.strict()` rejection of
 *    unknown keys; code/notes trimming + length bounds; positive-int locationId.
 * 3. HandlingUnitAssign/UnassignBody — units is REQUIRED (min 1), idempotencyKey
 *    optional, unknown keys rejected.
 */

import { test } from 'node:test';
import { ok, equal, deepEqual } from 'node:assert';
import {
  HandlingUnitCreateBody,
  HandlingUnitAssignBody,
  HandlingUnitUnassignBody,
} from './handling-unit';

// ─── unitRefs (exercised via the bodies that embed it) ───────────────────────

test('units: mixed number/string refs are coerced to a string[]', () => {
  const r = HandlingUnitAssignBody.safeParse({ units: [1, 'U-5', '  SN-9  ', 42] });
  ok(r.success, 'mixed id/handle/serial refs should validate');
  // Numbers stringified; the string branch trims before String() leaves it.
  deepEqual(r.data.units, ['1', 'U-5', 'SN-9', '42']);
});

test('units: empty array is rejected (min 1 ref required)', () => {
  const r = HandlingUnitAssignBody.safeParse({ units: [] });
  ok(!r.success, 'an empty units array must fail');
});

test('units: a non-positive / non-integer numeric ref is rejected', () => {
  ok(!HandlingUnitAssignBody.safeParse({ units: [0] }).success, '0 is not a positive int');
  ok(!HandlingUnitAssignBody.safeParse({ units: [-3] }).success, 'negatives rejected');
  ok(!HandlingUnitAssignBody.safeParse({ units: [1.5] }).success, 'non-integers rejected');
});

test('units: a quoted "0" passes via the string branch (it is a valid ref token)', () => {
  // The union tries string first; "0" has length 1 so it is a legal ref string,
  // unlike the number 0 which fails the positive-int branch.
  const r = HandlingUnitAssignBody.safeParse({ units: ['0'] });
  ok(r.success, 'a quoted "0" is a non-empty ref string');
  deepEqual(r.data.units, ['0']);
});

test('units: more than 500 refs is rejected (batch cap)', () => {
  const tooMany = Array.from({ length: 501 }, (_, i) => i + 1);
  ok(!HandlingUnitAssignBody.safeParse({ units: tooMany }).success, '>500 refs must fail');
  const atCap = Array.from({ length: 500 }, (_, i) => i + 1);
  ok(HandlingUnitAssignBody.safeParse({ units: atCap }).success, 'exactly 500 is allowed');
});

// ─── HandlingUnitCreateBody — mint ───────────────────────────────────────────

test('create: an empty body is valid (auto-mint H-{id}, empty box)', () => {
  const r = HandlingUnitCreateBody.safeParse({});
  ok(r.success, 'every create field is optional');
  equal(r.data.code, undefined);
  equal(r.data.units, undefined);
});

test('create: full body validates and seeds units coerced to strings', () => {
  const r = HandlingUnitCreateBody.safeParse({
    code: 'TOTE-77',
    locationId: 12,
    notes: 'staging A',
    units: [101, '202'],
    idempotencyKey: 'mint-key-1',
  });
  ok(r.success, 'a fully-specified mint body should validate');
  equal(r.data.code, 'TOTE-77');
  equal(r.data.locationId, 12);
  deepEqual(r.data.units, ['101', '202']);
});

test('create: an external code accepts null but rejects empty/over-length', () => {
  ok(HandlingUnitCreateBody.safeParse({ code: null }).success, 'null = auto-mint');
  ok(!HandlingUnitCreateBody.safeParse({ code: '   ' }).success, 'whitespace-only trims to empty');
  ok(!HandlingUnitCreateBody.safeParse({ code: 'x'.repeat(65) }).success, 'max 64 chars');
});

test('create: locationId must be a positive integer when present', () => {
  ok(HandlingUnitCreateBody.safeParse({ locationId: null }).success, 'null = no location');
  ok(!HandlingUnitCreateBody.safeParse({ locationId: 0 }).success, '0 is not positive');
  ok(!HandlingUnitCreateBody.safeParse({ locationId: -1 }).success, 'negatives rejected');
});

test('create: unknown keys are rejected (.strict)', () => {
  const r = HandlingUnitCreateBody.safeParse({ code: 'A', bogus: true });
  ok(!r.success, 'an unexpected key must fail the strict object');
});

// ─── HandlingUnitAssignBody / HandlingUnitUnassignBody ───────────────────────

test('assign: units is required and idempotencyKey is optional', () => {
  ok(!HandlingUnitAssignBody.safeParse({}).success, 'missing units must fail');
  const r = HandlingUnitAssignBody.safeParse({ units: [1], idempotencyKey: 'k' });
  ok(r.success);
  equal(r.data.idempotencyKey, 'k');
});

test('assign: unknown keys are rejected (.strict)', () => {
  ok(!HandlingUnitAssignBody.safeParse({ units: [1], extra: 1 }).success, 'strict rejects extras');
});

test('unassign: same contract as assign (units required, strict)', () => {
  ok(!HandlingUnitUnassignBody.safeParse({}).success, 'missing units must fail');
  ok(!HandlingUnitUnassignBody.safeParse({ units: [1], extra: 1 }).success, 'strict rejects extras');
  const r = HandlingUnitUnassignBody.safeParse({ units: ['U-9'] });
  ok(r.success);
  deepEqual(r.data.units, ['U-9']);
});
