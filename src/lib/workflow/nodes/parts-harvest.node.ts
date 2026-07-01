/**
 * `parts_harvest` — scrap/harvest landing node. The destination for the
 * `returns` node's `scrap` port (see its own docstring: "scrap → harvest for
 * parts / dispose"). Named from the reseller node-library target catalog
 * (`.claude/skills/workflow-node/SKILL.md`'s "Returns" row already lists
 * `parts_harvest`), not a generic `scrap` type — this IS that node, arrived
 * at from its first real trigger.
 *
 * Thin adapter — the domain write already happened upstream (`recordDisposition`
 * inserted the `return_dispositions` SCRAP row before the tap fires); this
 * node only makes the position observable. `SCRAPPED` is a real, terminal
 * `serial_units.current_status` (src/lib/inventory/state-machine.ts) but
 * `recordDisposition`'s SCRAP branch does not transition to it today (only
 * ACCEPT does) — that is a separate, pre-existing gap this node deliberately
 * does not paper over by inventing a status write here.
 *
 * Zero declared outputs = terminal (auto-advance, no `await` — nothing left
 * for a human to finish at this position).
 */

import { registerNode } from '../registry';
import type { NodeContext, NodeResult } from '../contract';

const TERMINAL_OUTPUT = 'arrived';

registerNode({
  type: 'parts_harvest',
  label: 'Scrap / Parts Harvest',
  icon: 'Recycle',
  category: 'process',
  outputs: [{ id: TERMINAL_OUTPUT, label: 'Arrived' }],
  async run(ctx: NodeContext): Promise<NodeResult> {
    return {
      output: TERMINAL_OUTPUT,
      data: {
        rmaRef: ctx.input.rmaRef ?? null,
        returnReason: ctx.input.returnReason ?? null,
      },
    };
  },
});
