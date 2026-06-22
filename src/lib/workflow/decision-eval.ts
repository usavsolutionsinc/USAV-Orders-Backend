/**
 * decision-eval — the pure rule-table evaluator behind the `decision` node.
 *
 * Track 1, Stage 1 (in-house): instead of routing baked into a node's port()
 * (inspection's verdict→port), an OPERATOR-EDITABLE rule table picks the output
 * port from item facts (grade / channel / disposition). This module is the pure
 * core — no node, no engine, no DB — so first-match-wins, partial-when matching
 * and the default fallback are all unit-testable in isolation
 * (decision-eval.test.ts).
 *
 * Stage 2 (deferred) swaps this hand-rolled matcher for a GoRules ZEN decision
 * table; the node + editor + this signature stay, only the engine inside flips.
 * See docs/operations-studio/ — Track 1 decision/placement layer.
 */

/** The facts a rule matches against — the item's current routing-relevant context. */
export interface DecisionFacts {
  grade?: unknown;
  channel?: unknown;
  disposition?: unknown;
}

/** A single when→then row. Every PRESENT `when` key must equal the fact to match. */
export interface DecisionRule {
  id: string;
  when: {
    grade?: string;
    channel?: string;
    disposition?: string;
  };
  /** The output port id this rule routes to when it matches. */
  thenPort: string;
}

/** The three fact keys a rule can constrain on (kept in sync with DecisionRule.when). */
const WHEN_KEYS = ['grade', 'channel', 'disposition'] as const;

/**
 * Does a rule match the facts? A rule matches when EVERY present `when` key
 * equals the corresponding fact (compared as strings, so a numeric grade and a
 * "3" rule still line up). An empty `when: {}` is a catch-all that always
 * matches — placed last it doubles as an inline default.
 */
function ruleMatches(rule: DecisionRule, facts: DecisionFacts): boolean {
  for (const key of WHEN_KEYS) {
    const expected = rule.when?.[key];
    if (expected == null || expected === '') continue; // key not constrained
    const actual = facts[key];
    if (actual == null) return false;
    if (String(actual) !== String(expected)) return false;
  }
  return true;
}

/**
 * Evaluate the rule table against the facts.
 *   • FIRST matching rule wins → its `thenPort`.
 *   • No rule matches → `defaultPort` (or null when none is set, which the node
 *     turns into a park so a misrouted item is never silently dropped).
 */
export function evaluateDecision(
  rules: readonly DecisionRule[],
  defaultPort: string | null | undefined,
  facts: DecisionFacts,
): string | null {
  for (const rule of rules) {
    if (ruleMatches(rule, facts)) return rule.thenPort;
  }
  return defaultPort ?? null;
}
