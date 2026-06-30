/**
 * stationNode — the factory behind every built-in floor node.
 *
 * Phase-1 engine taps run AFTER the domain mutation commits (the "tap-after"
 * pattern, see ../tap.ts): receiving/testing/repair routes do their work via
 * the existing src/lib/* modules, then tapWorkflow() advances the unit. So a
 * node's run() does NO domain work — it only translates the domain event in
 * ctx.input into an output port. That keeps the one law intact (no business
 * logic in nodes) with the engine as observer, not driver.
 *
 * Every station node is event-gated: unless ctx.input.event is the event the
 * node is waiting on, it parks (`await: true`). This is what makes taps
 * idempotent — replaying an event against a unit that already advanced past
 * the node just re-parks it where it sits, it never double-advances.
 */

import type { NodeContext, NodeDefinition, NodeOutputPort, NodeResult } from '../contract';

/** Owner-tunable knobs every station node exposes (no secrets here, ever). */
export const STATION_CONFIG_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    slaHours: {
      type: 'number',
      title: 'SLA hours',
      description: 'Flag units that sit at this step longer than this.',
    },
    station: {
      type: 'string',
      title: 'Station',
      description: 'Operations-catalog station key this step runs at.',
    },
    trigger: {
      type: 'string',
      title: 'Top bar',
      description:
        'How operators start work here: a focus-locked scan bar, or a recent-activity feed only (no scan entry / top banner).',
      options: [
        { value: 'scan', label: 'Scan bar' },
        { value: 'feed', label: 'Feed only (no scan)' },
      ],
      default: 'scan',
    },
  },
};

/** The trigger-slot modes a station node can render its top bar as. */
export type StationTrigger = 'scan' | 'feed';

/**
 * Read the configured trigger mode off a station node's config bag, defaulting
 * to 'scan' (today's hardcoded behavior) for any node that hasn't set it.
 * Single source of truth so the Inspector knob and the station UI never drift.
 */
export function stationTrigger(config: Record<string, unknown> | null | undefined): StationTrigger {
  return config?.trigger === 'feed' ? 'feed' : 'scan';
}

interface StationNodeOpts {
  type: string;
  label: string;
  icon: string;
  category: NodeDefinition['category'];
  outputs: NodeOutputPort[];
  /**
   * Map a tap's input (event + payload) to an output port id, or null to
   * keep waiting at this node.
   */
  port: (input: Record<string, unknown>) => string | null;
  /** Optional context patch recorded when the node fires (for downstream nodes). */
  data?: (ctx: NodeContext) => Record<string, unknown>;
}

export function stationNode(opts: StationNodeOpts): NodeDefinition {
  return {
    type: opts.type,
    label: opts.label,
    icon: opts.icon,
    category: opts.category,
    outputs: opts.outputs,
    configSchema: STATION_CONFIG_SCHEMA,
    async run(ctx): Promise<NodeResult> {
      const output = opts.port(ctx.input);
      if (!output) {
        // Not this node's event (or a human is mid-step) — park, don't route.
        return { output: 'awaiting', await: true };
      }
      return { output, data: opts.data?.(ctx) };
    },
  };
}
