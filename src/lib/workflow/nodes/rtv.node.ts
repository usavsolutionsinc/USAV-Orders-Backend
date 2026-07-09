/**
 * `rtv` — return-to-vendor landing node. The destination for the `returns`
 * node's `rtv` port: a unit whose disposition was decided as "send back to
 * the supplier" lands here.
 *
 * Thin adapter, and in this case an unusually thin one: by the time a unit
 * is routed here (the `returns` node's Tap 2, fired from `recordDisposition`,
 * src/lib/rma/authorizations.ts), the domain write already happened — the
 * `return_dispositions` row and the RMA/allocation bookkeeping are done. This
 * node has no further domain call to make; it exists so an RTV disposition is
 * visible as a real position in the graph (Studio's Live lens, `workflow_runs`
 * observability) instead of the `returns` node simply having a dead-end port.
 * No new status vocabulary: RTV does not change `serial_units.current_status`
 * today (only ACCEPT does, via `recordDisposition`'s restock branch) — this
 * node does not invent one either.
 *
 * Zero declared outputs = a terminal node (auto-advance, no further routing):
 * the moment a unit lands here the run resolves to `done`. Deliberately no
 * `await` — there is nothing left for a human to finish at this position.
 */

import { registerNode } from '../registry';
import type { NodeContext, NodeResult } from '../contract';

const TERMINAL_OUTPUT = 'arrived';

registerNode({
  type: 'rtv',
  label: 'Return to Vendor',
  icon: 'Undo2',
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
