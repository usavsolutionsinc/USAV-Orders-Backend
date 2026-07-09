/**
 * decision-eval — the pure rule-table evaluator (Track 1, Stage 1).
 * Proves first-match-wins, partial-when matching, default fallback, and
 * no-match→null independent of the node/engine.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateDecision,
  parseDecisionPlacement,
  parseDecisionRules,
  resolveDecision,
  type DecisionRule,
} from './decision-eval';

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

// — placement seam (Stage 1.x) —

test('resolveDecision returns the matched rule placement directive alongside the port', () => {
  const rules: DecisionRule[] = [
    { id: 'parts', when: { grade: 'C' }, thenPort: 'parts', then: { placement: 'TECH-PARTS', category: 'parts' } },
    { id: 'fba', when: { channel: 'amazon' }, thenPort: 'fba-prep', then: { targetQueue: 'fba', placement: 'FBA-STAGING' } },
  ];
  assert.deepEqual(resolveDecision(rules, null, { grade: 'C' }), {
    port: 'parts',
    placement: { placement: 'TECH-PARTS', category: 'parts' },
  });
  assert.deepEqual(resolveDecision(rules, null, { channel: 'amazon' }), {
    port: 'fba-prep',
    placement: { targetQueue: 'fba', placement: 'FBA-STAGING' },
  });
});

test('a route-only rule (no `then`) yields placement: null — byte-identical to the pre-seam behavior', () => {
  const rules = [rule('r1', { grade: 'A' }, 'premium')];
  assert.deepEqual(resolveDecision(rules, null, { grade: 'A' }), { port: 'premium', placement: null });
  // and evaluateDecision still returns just the port, exactly as before
  assert.equal(evaluateDecision(rules, null, { grade: 'A' }), 'premium');
});

test('the default fallback carries no placement (a default is a graph lane only)', () => {
  const rules: DecisionRule[] = [
    { id: 'r1', when: { grade: 'A' }, thenPort: 'premium', then: { placement: 'A-BIN' } },
  ];
  assert.deepEqual(resolveDecision(rules, 'reject', { grade: 'C' }), { port: 'reject', placement: null });
});

test('no match and no default → { port: null, placement: null }', () => {
  const rules: DecisionRule[] = [
    { id: 'r1', when: { grade: 'A' }, thenPort: 'premium', then: { placement: 'A-BIN' } },
  ];
  assert.deepEqual(resolveDecision(rules, null, { grade: 'C' }), { port: null, placement: null });
});

test('first match wins for placement too — the earlier rule placement is the one returned', () => {
  const rules: DecisionRule[] = [
    { id: 'r1', when: { grade: 'A' }, thenPort: 'premium', then: { placement: 'PREMIUM-BIN' } },
    { id: 'r2', when: { grade: 'A' }, thenPort: 'standard', then: { placement: 'STANDARD-BIN' } },
  ];
  assert.deepEqual(resolveDecision(rules, null, { grade: 'A' }), {
    port: 'premium',
    placement: { placement: 'PREMIUM-BIN' },
  });
});

// — parseDecisionPlacement (the shared `then` SoT) —

test('parseDecisionPlacement: trims fields and drops empties; all-blank → null', () => {
  assert.equal(parseDecisionPlacement(null), null);
  assert.equal(parseDecisionPlacement('not an object'), null);
  assert.equal(parseDecisionPlacement({}), null);
  assert.equal(parseDecisionPlacement({ placement: '  ', category: '' }), null);
  assert.deepEqual(parseDecisionPlacement({ placement: '  TECH-PARTS  ' }), { placement: 'TECH-PARTS' });
  assert.deepEqual(
    parseDecisionPlacement({ placement: 'B', category: 'parts', targetTable: '', targetQueue: 'fba' }),
    { placement: 'B', category: 'parts', targetQueue: 'fba' },
  );
});

// — parseDecisionRules (the shared rule-table SoT) —

test('parseDecisionRules: coerces operator JSON, preserves `then`, drops thenPort-less rows', () => {
  const raw = [
    { id: 'a', when: { grade: 3 }, thenPort: 'g3', then: { placement: 'A-BIN', category: 'graded' } },
    { id: 'b', when: { disposition: 'parts' }, thenPort: 'parts' }, // route-only
    { id: 'c', when: {}, thenPort: '' }, // unwireable → dropped
    'garbage',
  ];
  const rules = parseDecisionRules(raw);
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0], {
    id: 'a',
    when: { grade: '3', channel: undefined, disposition: undefined },
    thenPort: 'g3',
    then: { placement: 'A-BIN', category: 'graded' },
  });
  assert.equal(rules[1].then, undefined); // route-only rule has no placement
});

test('parseDecisionRules: a non-array is an empty table', () => {
  assert.deepEqual(parseDecisionRules(undefined), []);
  assert.deepEqual(parseDecisionRules({ not: 'an array' }), []);
});
