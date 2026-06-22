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
 * port. Placement (moving the unit to a bin / channel / disposition) is the
 * DEFERRED Stage 1.x follow-up; that money/inventory-adjacent strangle stays in
 * applyTransition + the 22 hardcoded placement sites until then.
 *
 * TODO(decision-layer Stage 1.x): placement output — once the placement
 * strangle lands, the chosen rule may also carry a placement directive (bin /
 * channel) threaded through applyTransition. For now the node is route-only.
 * See docs/operations-studio/ — Track 1 decision/placement layer roadmap.
 *
 * Outputs come from `config.outputs` (per-instance ports the canvas draws), so a
 * decision can fan to as many lanes as the operator declares. The registry
 * declares a sensible default pair so a freshly dropped node is still wireable
 * before it's configured.
 */

import type { NodeContext, NodeDefinition, NodeOutputPort, NodeResult } from '../contract';
import { evaluateDecision, type DecisionFacts, type DecisionRule } from '../decision-eval';
import { registerNode } from '../registry';

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

/** Read the rule table from config (defensively — config is operator JSON). */
function configRules(config: Record<string, unknown>): DecisionRule[] {
  const raw = config.rules;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const row = (r ?? {}) as Record<string, unknown>;
      const when = (row.when ?? {}) as Record<string, unknown>;
      return {
        id: String(row.id ?? ''),
        when: {
          grade: when.grade != null ? String(when.grade) : undefined,
          channel: when.channel != null ? String(when.channel) : undefined,
          disposition: when.disposition != null ? String(when.disposition) : undefined,
        },
        thenPort: String(row.thenPort ?? ''),
      };
    })
    .filter((r) => r.thenPort);
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

    const port = evaluateDecision(rules, defaultPort, gatherFacts(ctx));
    if (!port) {
      // No rule matched and no default — park rather than silently drop.
      return { output: 'awaiting', await: true };
    }
    return { output: port };
  },
});
