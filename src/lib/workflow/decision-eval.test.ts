/**
 * decision-eval — the pure rule-table evaluator (Track 1, Stage 1).
 * Proves first-match-wins, partial-when matching, default fallback, and
 * no-match→null independent of the node/engine.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDecision, type DecisionRule } from './decision-eval';

const rule = (id: string, when: DecisionRule['when'], thenPort: string): DecisionRule => ({
  id,
  when,
  thenPort,
});

test('first match wins — earlier rule takes precedence over a later one that also matches', () => {
  const rules = [
    rule('r1', { grade: 'A' }, 'premium'),
    rule('r2', { grade: 'A' }, 'standard'), // also matches, but r1 is first
  ];
  assert.equal(evaluateDecision(rules, null, { grade: 'A' }), 'premium');
});

test('partial-when matches: every PRESENT key must equal; absent keys are unconstrained', () => {
  const rules = [rule('r1', { grade: 'B', channel: 'ebay' }, 'ebay-b')];
  // both keys line up → matches
  assert.equal(evaluateDecision(rules, null, { grade: 'B', channel: 'ebay' }), 'ebay-b');
  // a constrained key disagrees → no match → null (no default)
  assert.equal(evaluateDecision(rules, null, { grade: 'B', channel: 'amazon' }), null);
  // a constrained key is missing from the facts → no match
  assert.equal(evaluateDecision(rules, null, { grade: 'B' }), null);
});

test('an empty when {} is a catch-all that always matches', () => {
  const rules = [rule('catch', {}, 'fallback')];
  assert.equal(evaluateDecision(rules, null, {}), 'fallback');
  assert.equal(evaluateDecision(rules, null, { grade: 'anything' }), 'fallback');
});

test('default fallback fires when no rule matches', () => {
  const rules = [rule('r1', { grade: 'A' }, 'premium')];
  assert.equal(evaluateDecision(rules, 'reject', { grade: 'C' }), 'reject');
});

test('no match and no default → null (the node parks)', () => {
  const rules = [rule('r1', { grade: 'A' }, 'premium')];
  assert.equal(evaluateDecision(rules, null, { grade: 'C' }), null);
  assert.equal(evaluateDecision(rules, undefined, { grade: 'C' }), null);
});

test('an empty rule table falls straight through to the default (or null)', () => {
  assert.equal(evaluateDecision([], 'default-lane', { grade: 'A' }), 'default-lane');
  assert.equal(evaluateDecision([], null, { grade: 'A' }), null);
});

test('facts compare as strings, so a numeric grade still matches a string rule', () => {
  const rules = [rule('r1', { grade: '3' }, 'grade-3')];
  assert.equal(evaluateDecision(rules, null, { grade: 3 }), 'grade-3');
});

test('disposition is a routable fact alongside grade/channel', () => {
  const rules = [
    rule('scrap', { disposition: 'scrap' }, 'scrap-bin'),
    rule('rtv', { disposition: 'rtv' }, 'return-to-vendor'),
  ];
  assert.equal(evaluateDecision(rules, null, { disposition: 'rtv' }), 'return-to-vendor');
  assert.equal(evaluateDecision(rules, null, { disposition: 'scrap' }), 'scrap-bin');
});
