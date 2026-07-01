import test from 'node:test';
import assert from 'node:assert/strict';
import { isReturnIntake } from './triage-intake-kind';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

/** isReturnIntake only reads intake_type/receiving_type/carton_intake_type. */
function row(partial: {
  intake_type?: string | null;
  receiving_type?: string | null;
  carton_intake_type?: string | null;
}): ReceivingLineRow {
  return { receiving_type: null, ...partial } as ReceivingLineRow;
}

test('isReturnIntake: line intake_type RETURN wins', () => {
  assert.equal(isReturnIntake(row({ intake_type: 'return' })), true);
});

test('isReturnIntake: falls back to receiving_type when intake_type is unset', () => {
  assert.equal(isReturnIntake(row({ receiving_type: 'RETURN' })), true);
});

test('isReturnIntake: no line override, carton default RETURN', () => {
  assert.equal(isReturnIntake(row({ carton_intake_type: 'RETURN' })), true);
});

test('isReturnIntake: PO line override, carton default RETURN → carton wins (not an override)', () => {
  assert.equal(isReturnIntake(row({ intake_type: 'PO', carton_intake_type: 'RETURN' })), true);
});

test('isReturnIntake: nothing set anywhere → false (defaults to PO)', () => {
  assert.equal(isReturnIntake(row({})), false);
});

test('isReturnIntake: regression — an explicit non-RETURN line override beats a RETURN carton default', () => {
  // Before the fix this was an OR check ("line is RETURN OR carton is RETURN"),
  // so a line explicitly tagged TRADE_IN on a RETURN-default carton
  // misclassified as a return. The line override must win outright once set,
  // per effectiveIntakeKind's documented precedence.
  assert.equal(isReturnIntake(row({ intake_type: 'TRADE_IN', carton_intake_type: 'RETURN' })), false);
  assert.equal(isReturnIntake(row({ intake_type: 'PICKUP', carton_intake_type: 'RETURN' })), false);
});
