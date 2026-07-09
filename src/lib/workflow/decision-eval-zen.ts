/**
 * decision-eval-zen — GoRules ZEN-backed evaluator behind the `decision` node
 * (UNIFIED-ENGINE-MASTER-PLAN §1.6, Stage 2; gated by isDecisionEngineZen()).
 *
 * Stage 1 (decision-eval.ts) ships a hand-rolled first-match-wins matcher. Stage 2
 * swaps the matching ENGINE — not the node, the editor, the config shape, or the
 * result — for the GoRules ZEN engine. This module mirrors evaluateDecision()'s
 * call shape (rules, defaultPort, facts) and result (a port id, or null → park),
 * differing only in being async, because the WASM engine initializes lazily.
 *
 * WHICH ZEN BUILD THIS IS (load-bearing):
 *   `@gorules/zen-engine-wasm` (the browser/WASM build) is, per its own README,
 *   EXPRESSION-ONLY — it exports evaluateExpression()/evaluateUnaryExpression() and
 *   has NO ZenEngine / createDecision / JDM-decision-graph evaluator. That full
 *   decision-graph runtime lives only in the native napi `@gorules/zen-engine`,
 *   which §1.6 deliberately avoids (native binding). So we compile the rule table
 *   to an equivalent ZEN EXPRESSION — a first-match-wins ternary chain of equality
 *   tests — and evaluate that, instead of synthesizing a JDM decision-table graph.
 *   The routing semantics and result are identical to the in-house evaluator
 *   (proven across the in-house scenarios in decision-eval-zen.test.ts).
 *
 * ROBUSTNESS CONTRACT (keeps §1.6's "no-op until enabled" promise):
 *   • The WASM module is dynamically imported + initialized LAZILY on first real
 *     use — importing this file never touches WASM (so it is smoke-import safe and
 *     never runs at import time).
 *   • Load / init / evaluate are fully guarded: any failure logs once and falls
 *     back to the in-house evaluateDecision(), so an unavailable or finicky WASM
 *     runtime degrades to byte-identical Stage-1 behavior instead of 500-ing a
 *     route. The flag being OFF means this module's WASM path is never entered.
 *   • Pure + stateless apart from the cached engine handle: no DB, no side effects.
 */

import { evaluateDecision, type DecisionFacts, type DecisionRule } from './decision-eval';

/** The fact keys a rule can constrain on — kept in sync with decision-eval.ts. */
const WHEN_KEYS = ['grade', 'channel', 'disposition'] as const;

/** The one primitive we use from the expression-only WASM build. */
type ZenEvaluateExpression = (expression: string, context: unknown) => unknown;

/**
 * Optional pre-authored override. Because the WASM build is expression-only, a
 * stored "decision doc" here is a ready-to-run ZEN EXPRESSION string (the form a
 * future Studio editor would persist) — used verbatim instead of synthesizing one
 * from the rule table. A full JDM decision-table graph would need the native
 * engine and is intentionally out of scope for this build.
 */
export interface DecisionZenOptions {
  expression?: string;
}

// ─── Lazy, cached, never-throwing engine handle ────────────────────────────────
let zenLoad: Promise<ZenEvaluateExpression | null> | null = null;

async function loadZen(): Promise<ZenEvaluateExpression | null> {
  if (zenLoad) return zenLoad;
  zenLoad = (async (): Promise<ZenEvaluateExpression | null> => {
    try {
      // Genuine runtime imports — Turbopack's WASM loader expects a split
      // zen_engine_wasm_bg.js + .wasm pair this package does not ship (it uses
      // zen_engine_wasm.js + zen_engine_wasm_bg.wasm). Obfuscated specifiers +
      // webpackIgnore keep resolution in Node (same pattern as sharp in nas-dev).
      const zenPkg = ['@gorules/', 'zen-engine-wasm'].join('');
      const mod = (await import(/* webpackIgnore: true */ zenPkg)) as unknown as {
        default: (init: { module_or_path: BufferSource }) => Promise<unknown>;
        evaluateExpression?: ZenEvaluateExpression;
      };
      // wasm-pack --target web build: every export is inert until the module is
      // instantiated with the .wasm bytes — and the exports (isReady/evaluate*)
      // actually THROW if called pre-init — so we must NOT probe before init. Under
      // Node there is no fetch step, so read the bytes from the package's own dist
      // dir and instantiate exactly once (this whole loader is cached by zenLoad).
      const { createRequire } = await import('node:module');
      const { readFile } = await import('node:fs/promises');
      const { join, dirname } = await import('node:path');
      const require = createRequire(import.meta.url);
      const wasmPath = join(dirname(require.resolve(zenPkg)), 'dist', 'zen_engine_wasm_bg.wasm');
      const bytes = await readFile(wasmPath);
      await mod.default({ module_or_path: bytes });
      const evaluateExpression = mod.evaluateExpression;
      if (typeof evaluateExpression !== 'function') return null;
      return (expression: string, context: unknown) => evaluateExpression(expression, context);
    } catch (err) {
      console.warn(
        '[decision-eval-zen] ZEN WASM unavailable; decision node falls back to the in-house matcher:',
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  })();
  return zenLoad;
}

/**
 * Diagnostics / tests: whether the ZEN WASM engine could be loaded + initialized
 * in this runtime. Lets the parity test skip cleanly when the module isn't
 * loadable (e.g. an environment where the WASM can't instantiate).
 */
export async function isZenAvailable(): Promise<boolean> {
  return (await loadZen()) !== null;
}

// ─── Rule-table → ZEN expression compiler (pure) ───────────────────────────────

/** A safe ZEN string literal. JSON string syntax is a subset ZEN accepts. */
function zenString(value: string): string {
  return JSON.stringify(value);
}

/**
 * One rule's `when` → a ZEN boolean. Mirrors decision-eval's ruleMatches exactly:
 * every PRESENT key must equal the corresponding fact (compared as strings); an
 * empty `when` is the always-true catch-all. Wrapped in parens so it composes
 * unambiguously with the surrounding ternary.
 */
function compileCondition(when: DecisionRule['when']): string {
  const clauses: string[] = [];
  for (const key of WHEN_KEYS) {
    const expected = when?.[key];
    if (expected == null || expected === '') continue; // key not constrained
    clauses.push(`${key} == ${zenString(String(expected))}`);
  }
  return clauses.length ? `(${clauses.join(' and ')})` : 'true';
}

/**
 * Compile the whole table to a first-match-wins ternary chain:
 *   (c1) ? "p1" : (c2) ? "p2" : … : <default>
 * Right-associative ternary makes the earliest matching rule win, exactly like the
 * in-house loop. The default literal mirrors `defaultPort ?? null` (including the
 * empty-string edge: a '' default evaluates to '', not null).
 */
export function compileDecisionTableToZen(
  rules: readonly DecisionRule[],
  defaultPort: string | null | undefined,
): string {
  let expr = defaultPort == null ? 'null' : zenString(defaultPort);
  for (let i = rules.length - 1; i >= 0; i--) {
    expr = `${compileCondition(rules[i].when)} ? ${zenString(rules[i].thenPort)} : ${expr}`;
  }
  return expr;
}

/**
 * Facts → ZEN context. Coerce present facts to strings (so a numeric grade 3
 * matches a "3" rule, matching decision-eval's String() compare) and null out
 * absent keys (a constrained-but-missing key then fails its equality → no match).
 */
function toZenContext(facts: DecisionFacts): Record<string, string | null> {
  return {
    grade: facts.grade == null ? null : String(facts.grade),
    channel: facts.channel == null ? null : String(facts.channel),
    disposition: facts.disposition == null ? null : String(facts.disposition),
  };
}

/** Normalize the engine result to the node's port contract (string | null). */
function toPort(result: unknown): string | null {
  if (result == null) return null;
  return typeof result === 'string' ? result : String(result);
}

/**
 * ZEN-backed twin of evaluateDecision(). Same inputs + result (a port id, or null
 * → the node parks). Async only because the WASM engine initializes lazily. On any
 * ZEN load/eval failure it transparently falls back to the in-house evaluator, so
 * the caller always gets a correct route.
 */
export async function evaluateDecisionZen(
  rules: readonly DecisionRule[],
  defaultPort: string | null | undefined,
  facts: DecisionFacts,
  options?: DecisionZenOptions,
): Promise<string | null> {
  const evaluateExpression = await loadZen();
  if (!evaluateExpression) {
    // WASM unavailable → degrade to the in-house matcher (identical result).
    return evaluateDecision(rules, defaultPort, facts);
  }
  try {
    const expression =
      typeof options?.expression === 'string' && options.expression.trim()
        ? options.expression
        : compileDecisionTableToZen(rules, defaultPort);
    return toPort(evaluateExpression(expression, toZenContext(facts)));
  } catch (err) {
    console.warn(
      '[decision-eval-zen] ZEN evaluation failed; falling back to the in-house matcher:',
      err instanceof Error ? err.message : err,
    );
    return evaluateDecision(rules, defaultPort, facts);
  }
}
