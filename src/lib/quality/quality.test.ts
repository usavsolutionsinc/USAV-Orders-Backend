import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQualityScore, gradeToEbayConditionId } from './qualityScore';
import { evaluateGradeAdvice } from './gradeAdvice';

test('clean BRAND_NEW unit scores 100 / low risk', () => {
  const r = computeQualityScore({ grade: 'BRAND_NEW', openFailures: [], repairs: [], acquisition: null });
  assert.equal(r.score, 100);
  assert.equal(r.riskLevel, 'low');
  assert.equal(r.ebayConditionId, '1000');
});

test('open critical failure drags score and floors risk', () => {
  const r = computeQualityScore({
    grade: 'USED_A',
    openFailures: [{ severity: 'critical' }],
    repairs: [],
    acquisition: null,
  });
  assert.equal(r.score, 78 - 25); // 53
  assert.equal(r.riskLevel, 'high'); // <55 → high
  assert.ok(r.riskReasons.includes('open_critical_failure'));
});

test('completed repair gives a small confidence boost', () => {
  const base = computeQualityScore({ grade: 'REFURBISHED', openFailures: [], repairs: [], acquisition: null });
  const repaired = computeQualityScore({
    grade: 'REFURBISHED',
    openFailures: [],
    repairs: [{ status: 'completed' }],
    acquisition: null,
  });
  assert.ok(repaired.score >= base.score);
  assert.ok(repaired.riskReasons.includes('refurbished_repair'));
});

test('for_parts acquisition forces high risk + reason', () => {
  const r = computeQualityScore({
    grade: 'USED_B',
    openFailures: [],
    repairs: [],
    acquisition: { supplierType: 'salvage', condition: 'for_parts' },
  });
  assert.equal(r.riskLevel, 'high');
  assert.ok(r.riskReasons.includes('third_party_source'));
  assert.ok(r.riskReasons.includes('for_parts_source'));
});

test('PARTS grade is always high risk', () => {
  const r = computeQualityScore({ grade: 'PARTS', openFailures: [], repairs: [], acquisition: null });
  assert.equal(r.riskLevel, 'high');
  assert.equal(r.ebayConditionId, '7000');
});

test('gradeToEbayConditionId maps used grades to 3000', () => {
  assert.equal(gradeToEbayConditionId('USED_C'), '3000');
  assert.equal(gradeToEbayConditionId(null), null);
});

test('grade advice warns when grade beats a cap', () => {
  const { warnings } = evaluateGradeAdvice({
    grade: 'LIKE_NEW',
    openFailures: [{ label: 'Cracked housing', severity: 'major', capsGradeAt: 'USED_B' }],
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, 'grade_cap');
});

test('grade advice silent when grade respects the cap', () => {
  const { warnings } = evaluateGradeAdvice({
    grade: 'USED_C',
    openFailures: [{ label: 'Cracked housing', severity: 'major', capsGradeAt: 'USED_B' }],
  });
  assert.equal(warnings.length, 0);
});
