/**
 * `decision` — an operator-editable routing fork (Track 1, Stage 1: in-house).
 *
 * Where inspection.node hardcodes verdict→port, this node reads a RULE TABLE
 * from its own `config` and picks the output port from item facts (grade /
 * channel / disposition). The table lives in config — already per-definition,
 * versioned, and draft/published — so no new DB table is needed; the operator
 * edits it in the Studio Inspector's decision editor.
 *
 * Thin-adapter law (workflow-node §"the one law"): this node does NO domain
 * work, NO DB, NO side effects. It ONLY routes — evaluate the table, emit one
 * port. When the matched rule carries a `then` PLACEMENT directive (a symbolic
 * bin / lane / target-table), the node surfaces it on `NodeResult.data` so it
 * flows into the run context for the ACTION layer to consume — but the node
 * itself never resolves a bin or moves a unit. Resolving the symbol to a real
 * `bin_id` and handing it to `applyTransition({ binId })` is `placement.ts`'s
 * job; strangling the 22 hardcoded sites onto it is the per-site follow-up.
 *
 * A route-only rule (no `then`) emits NO `data` key, so a route-only decision
 * table behaves byte-identically to the pre-placement node.
 * See docs/operations-studio/ — Track 1 decision/placement layer roadmap.
 *
 * Outputs come from `config.outputs` (per-instance ports the canvas draws), so a
 * decision can fan to as many lanes as the operator declares. The registry
 * declares a sensible default pair so a freshly dropped node is still wireable
 * before it's configured.
 */

import type { NodeContext, NodeDefinition, NodeOutputPort, NodeResult } from '../contract';
import {
  parseDecisionRules,
  resolveDecision,
  type DecisionFacts,
} from '../decision-eval';
import { registerNode } from '../registry';
import { isDecisionEngineZen } from '@/lib/feature-flags';

/** Default ports for a freshly dropped, not-yet-configured decision node. */
const DEFAULT_OUTPUTS: NodeOutputPort[] = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
];

/**
 * Owner-tunable shape. The rule table (`outputs` / `rules` / `defaultPort`) is
 * an array-of-objects the generic scalar NodeConfigForm can't express, so the
 * Studio Inspector renders a CUSTOM editor for it — this marker just tells the
 * palette the node IS configurable (and documents the keys).
 */
export const DECISION_CONFIG_SCHEMA: Record<string, unknown> = {
  type: 'object',
  'x-editor': 'decision-rules',
  properties: {
    outputs: {
      type: 'array',
      title: 'Output ports',
      description: 'The lanes this fork can route to (id + label).',
    },
    rules: {
      type: 'array',
      title: 'Rules',
      description: 'When grade/channel/disposition match, route to a port (first match wins).',
    },
    defaultPort: {
      type: 'string',
      title: 'Default port',
      description: 'Where unmatched items go. Unset → the item parks for a human.',
    },
  },
};

/** Read the declared output ports from config, falling back to the defaults. */
function configOutputs(config: Record<string, unknown>): NodeOutputPort[] {
  const raw = config.outputs;
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_OUTPUTS;
  return raw
    .map((o) => {
      const id = String((o as Record<string, unknown>)?.id ?? '');
      const label = String((o as Record<string, unknown>)?.label ?? '') || id;
      return { id, label };
    })
    .filter((o) => o.id);
}

/** Read the rule table from config via the shared SoT parser (incl. `then`). */
function configRules(config: Record<string, unknown>) {
  return parseDecisionRules(config.rules);
}

/**
 * Gather routing facts. Decision facts can arrive on the live trigger payload
 * (ctx.input — a scan/verdict) or be accumulated from upstream nodes
 * (ctx.context — e.g. a grade an earlier node recorded). input wins.
 */
function gatherFacts(ctx: NodeContext): DecisionFacts {
  const pick = (key: string): unknown => ctx.input[key] ?? ctx.context[key];
  return {
    grade: pick('grade'),
    channel: pick('channel'),
    disposition: pick('disposition'),
  };
}

registerNode({
  type: 'decision',
  label: 'Decision',
  icon: 'GitBranch',
  category: 'logic',
  // The canvas reads the static registry outputs for the palette chip; a placed
  // node's real ports come from its config (resolved per-instance server-side).
  outputs: DEFAULT_OUTPUTS,
  configSchema: DECISION_CONFIG_SCHEMA,
  async run(ctx: NodeContext): Promise<NodeResult> {
    const rules = configRules(ctx.config);
    const defaultPort =
      typeof ctx.config.defaultPort === 'string' && ctx.config.defaultPort
        ? ctx.config.defaultPort
        : null;

    // In-house resolve always runs: it yields the matched rule's PLACEMENT
    // directive (the port half may be overridden by ZEN below). Placement is not
    // part of ZEN's expression compilation yet (Stage 2 follow-up); since the ZEN
    // port is parity-tested byte-identical to the in-house port, the matched rule
    // — and therefore its placement — is the same either way.
    const facts = gatherFacts(ctx);
    const outcome = resolveDecision(rules, defaultPort, facts);

    // Stage 2 (§1.6): behind DECISION_ENGINE_ZEN, route through the GoRules ZEN
    // expression engine; default OFF keeps the byte-identical in-house path. The
    // ZEN evaluator self-guards (falls back to in-house on any WASM failure).
    const port = isDecisionEngineZen()
      ? await (await import('../decision-eval-zen')).evaluateDecisionZen(rules, defaultPort, facts)
      : outcome.port;
    if (!port) {
      // No rule matched and no default — park rather than silently drop.
      return { output: 'awaiting', await: true };
    }
    // Surface the placement directive to the action layer via the run context.
    // Route-only rule → no placement → no `data` key (byte-identical to before).
    return outcome.placement
      ? { output: port, data: { placement: outcome.placement } }
      : { output: port };
  },
});
