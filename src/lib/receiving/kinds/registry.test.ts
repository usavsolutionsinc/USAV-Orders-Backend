import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isIntakeKind,
  intakeKindLabel,
  factTablesForKind,
  intakeKindFromClassification,
  classifyIntakeKind,
  effectiveIntakeKind,
} from './registry';

test('factTablesForKind layers kind-specific tables on the universal stage tables', () => {
  assert.deepEqual(factTablesForKind('PO'), [
    'receiving_line_zoho',
    'receiving_line_testing',
    'receiving_line_putaway',
  ]);
  assert.deepEqual(factTablesForKind('RETURN'), [
    'receiving_line_return',
    'receiving_line_testing',
    'receiving_line_putaway',
  ]);
  // PICKUP carries only the universal stage tables
  assert.deepEqual(factTablesForKind('PICKUP'), ['receiving_line_testing', 'receiving_line_putaway']);
});

test('intakeKindFromClassification collapses fine door tags to coarse kinds', () => {
  assert.equal(intakeKindFromClassification('FBA_RETURN'), 'RETURN');
  assert.equal(intakeKindFromClassification('AMAZON_RETURN'), 'RETURN');
  assert.equal(intakeKindFromClassification('EBAY_RETURN_USAV'), 'RETURN');
  assert.equal(intakeKindFromClassification('TRADE_IN'), 'TRADE_IN');
  assert.equal(intakeKindFromClassification('LOCAL_PICKUP'), 'PICKUP');
  assert.equal(intakeKindFromClassification('PO'), 'PO');
  assert.equal(intakeKindFromClassification('UNKNOWN'), 'PO');
});

test('classifyIntakeKind derives the kind from stored carton columns', () => {
  assert.equal(classifyIntakeKind({ is_return: true, return_platform: 'FBA' }), 'RETURN');
  assert.equal(classifyIntakeKind({ receiving_type: 'TRADE_IN' }), 'TRADE_IN');
  assert.equal(classifyIntakeKind({ receiving_type: 'PICKUP' }), 'PICKUP');
  assert.equal(classifyIntakeKind({ receiving_type: 'PO' }), 'PO');
});

test('effectiveIntakeKind: line override wins unless it is PO, else carton, else PO', () => {
  assert.equal(effectiveIntakeKind('RETURN', 'PO'), 'RETURN'); // line override wins
  assert.equal(effectiveIntakeKind('PO', 'RETURN'), 'RETURN'); // PO line ≈ no override → carton wins
  assert.equal(effectiveIntakeKind(null, 'TRADE_IN'), 'TRADE_IN');
  assert.equal(effectiveIntakeKind(null, null), 'PO');
  assert.equal(effectiveIntakeKind('garbage', 'also-garbage'), 'PO'); // unknown → PO
  assert.equal(effectiveIntakeKind('return', null), 'RETURN'); // case-insensitive
});

test('label + guard basics', () => {
  assert.equal(intakeKindLabel('PICKUP'), 'Local Pickup');
  assert.equal(isIntakeKind('PO'), true);
  assert.equal(isIntakeKind('NOPE'), false);
});
