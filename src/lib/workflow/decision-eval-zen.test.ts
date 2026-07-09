/**
 * decision-eval-zen — parity test (Track 1, Stage 2).
 * Proves the GoRules ZEN-backed evaluator returns the SAME routing as the in-house
 * Stage-1 matcher across representative rule tables, so flipping DECISION_ENGINE_ZEN
 * is a pure engine swap. Skips cleanly when the WASM module isn't loadable in this
 * runtime (e.g. CI without the prebuilt .wasm), since unavailability simply means
 * the node keeps using the in-house path.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDecision, type DecisionRule } from './decision-eval';
import {
  evaluateDecisionZen,
  compileDecisionTableToZen,
  isZenAvailable,
} from './decision-eval-zen';

const rule = (id: string, when: DecisionRule['when'], thenPort: string): DecisionRule => ({
  id,
  when,
  thenPort,
});

// When the WASM engine can't load, evaluateDecisionZen() transparently falls back
// to the in-house evaluator — making a parity assertion trivially true and NOT a
// real test — so a WASM-dependent test skips itself instead. (Checked in-body, not
// at top level: tsx transforms .test.ts to CJS, where top-level await is illegal.)
const SKIP_REASON = '@gorules/zen-engine-wasm not loadable in this runtime';

interface ParityCase {
  name: string;
  rules: DecisionRule[];
  defaultPort: string | null | undefined;
  facts: Array<Record<string, unknown>>;
}

// 3 representative tables exercising: grade routing + default, multi-key partial
// `when` + catch-all, and first-match precedence across disposition/grade.
const CASES: ParityCase[] = [
  {
    name: 'grade routing with a default lane',
    rules: [rule('a', { grade: 'A' }, 'premium'), rule('b', { grade: 'B' }, 'standard')],
    defaultPort: 'reject',
    facts: [{ grade: 'A' }, { grade: 'B' }, { grade: 'C' }, { grade: 3 }, {}],
  },
  {
    name: 'multi-key partial-when with a catch-all, no default',
    rules: [
      rule('ebay-prem', { grade: 'A', channel: 'ebay' }, 'ebay-premium'),
      rule('amazon', { channel: 'amazon' }, 'amazon-lane'),
      rule('catch', {}, 'manual'),
    ],
    defaultPort: null,
    facts: [
      { grade: 'A', channel: 'ebay' },
      { grade: 'B', channel: 'ebay' },
      { channel: 'amazon' },
      { grade: 'A' },
      { disposition: 'whatever' },
    ],
  },
  {
    name: 'first-match precedence across disposition + grade',
    rules: [
      rule('scrap', { disposition: 'scrap' }, 'scrap-bin'),
      rule('rtv', { disposition: 'rtv' }, 'return-to-vendor'),
      rule('a', { grade: 'A' }, 'a-lane'),
    ],
    defaultPort: undefined,
    facts: [
      { disposition: 'rtv' },
      { disposition: 'scrap' },
      { grade: 'A', disposition: 'scrap' }, // disposition rule is earlier → wins
      { grade: 'A' },
      {},
    ],
  },
];

test('ZEN evaluator matches the in-house evaluator across representative tables', async (t) => {
  if (!(await isZenAvailable())) return t.skip(SKIP_REASON);
  for (const c of CASES) {
    for (const facts of c.facts) {
      const inHouse = evaluateDecision(c.rules, c.defaultPort, facts);
      const zen = await evaluateDecisionZen(c.rules, c.defaultPort, facts);
      assert.equal(
        zen,
        inHouse,
        `mismatch in "${c.name}" for facts ${JSON.stringify(facts)}: zen=${JSON.stringify(zen)} inHouse=${JSON.stringify(inHouse)}`,
      );
    }
  }
});

test('ZEN actually routes (hand-checked literals, not just == in-house)', async (t) => {
  if (!(await isZenAvailable())) return t.skip(SKIP_REASON);
  // first-match precedence: the disposition rule precedes the grade rule
  assert.equal(
    await evaluateDecisionZen(CASES[2].rules, CASES[2].defaultPort, { grade: 'A', disposition: 'scrap' }),
    'scrap-bin',
  );
  // numeric fact coerces to string, matching a string rule (parity with String() compare)
  assert.equal(await evaluateDecisionZen(CASES[0].rules, 'reject', { grade: 'A' }), 'premium');
  // no match, no default → null (the node parks)
  assert.equal(await evaluateDecisionZen([rule('a', { grade: 'A' }, 'premium')], null, { grade: 'Z' }), null);
});

test('a stored ZEN expression overrides the synthesized table', async (t) => {
  if (!(await isZenAvailable())) return t.skip(SKIP_REASON);
  // options.expression is used verbatim (expression-only WASM build), ignoring the
  // (empty) rule table it is passed alongside.
  assert.equal(
    await evaluateDecisionZen([], null, { grade: 'A' }, { expression: '"forced-port"' }),
    'forced-port',
  );
  assert.equal(
    await evaluateDecisionZen([], null, { grade: 'A' }, { expression: 'grade == "A" ? "via-expr" : null' }),
    'via-expr',
  );
});

// Pure-compiler checks run regardless of WASM availability (no engine needed).
test('compileDecisionTableToZen emits a first-match-wins ternary chain', () => {
  assert.equal(
    compileDecisionTableToZen([rule('a', { grade: 'A' }, 'premium')], 'reject'),
    '(grade == "A") ? "premium" : "reject"',
  );
  // empty table → bare default literal; null default → bare null
  assert.equal(compileDecisionTableToZen([], 'fallback'), '"fallback"');
  assert.equal(compileDecisionTableToZen([], null), 'null');
  // empty `when` → always-true catch-all
  assert.equal(compileDecisionTableToZen([rule('c', {}, 'manual')], null), 'true ? "manual" : null');
});
