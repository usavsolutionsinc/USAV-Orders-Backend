import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classificationToColumns,
  columnsToClassification,
  isIntakeClassification,
  INTAKE_CLASSIFICATION_OPTS,
  type IntakeClassification,
} from '@/lib/receiving/intake-classification';

const ALL: IntakeClassification[] = INTAKE_CLASSIFICATION_OPTS.map((o) => o.value);

test('isIntakeClassification accepts known values, rejects junk', () => {
  assert.equal(isIntakeClassification('FBA_RETURN'), true);
  assert.equal(isIntakeClassification('po'), false); // case-sensitive
  assert.equal(isIntakeClassification('nope'), false);
  assert.equal(isIntakeClassification(null), false);
  assert.equal(isIntakeClassification(42), false);
});

test('FBA_RETURN maps to the return columns the unboxer reads', () => {
  const c = classificationToColumns('FBA_RETURN');
  assert.deepEqual(c, {
    receiving_type: 'RETURN',
    is_return: true,
    return_platform: 'FBA',
    source_platform: 'fba',
  });
});

test('PO and UNKNOWN are not returns', () => {
  for (const v of ['PO', 'UNKNOWN', 'TRADE_IN', 'LOCAL_PICKUP'] as IntakeClassification[]) {
    assert.equal(classificationToColumns(v).is_return, false, `${v} should not be a return`);
    assert.equal(classificationToColumns(v).return_platform, null);
  }
});

test('every return classification round-trips through columnsToClassification', () => {
  const returns: IntakeClassification[] = [
    'FBA_RETURN',
    'AMAZON_RETURN',
    'EBAY_RETURN_DH',
    'EBAY_RETURN_USAV',
    'EBAY_RETURN_MK',
    'WALMART_RETURN',
  ];
  for (const v of returns) {
    const cols = classificationToColumns(v);
    assert.equal(columnsToClassification(cols), v, `${v} did not round-trip`);
  }
});

test('non-return classifications round-trip via receiving_type', () => {
  for (const v of ['PO', 'TRADE_IN', 'LOCAL_PICKUP', 'UNKNOWN'] as IntakeClassification[]) {
    const cols = classificationToColumns(v);
    assert.equal(columnsToClassification(cols), v, `${v} did not round-trip`);
  }
});

test('source_platform values are valid receiving enum members', () => {
  const allowed = new Set(['ebay', 'amazon', 'fba', 'aliexpress', 'walmart', 'goodwill', 'ecwid', 'other', 'zoho']);
  for (const v of ALL) {
    const sp = classificationToColumns(v).source_platform;
    if (sp != null) assert.ok(allowed.has(sp), `${v} → invalid source_platform "${sp}"`);
  }
});
