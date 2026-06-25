/**
 * `kit_verify` — confirm the box contents against the SKU's kit-parts BOM,
 * between `pack` and `ship`. The matched/short verdict is owned by
 * src/lib/packing/kit-readiness (the SoT shared with the packer UI); like every
 * station node, run() does NO domain work — it only routes the tap's outcome.
 *
 * Event-gated on `pack_verified`; routes on `ctx.input.kitComplete`:
 *   verified        — all critical kit parts confirmed → continue to ship
 *   needs_attention — something missing → park for rework / supervisor
 *
 * Consistent with `pack`/`ship`, the node exists ahead of its tap: no domain
 * site fires `pack_verified` yet (that lands when the packer adopts a
 * scan→confirm gate, or when block_until_matched persists confirmations). Until
 * then it sits available in the Studio palette, documenting the graph intent.
 */

import { registerNode } from '../registry';
import { stationNode } from './station-node';

registerNode(
  stationNode({
    type: 'kit_verify',
    label: 'Verify Kit',
    icon: 'PackageCheck',
    category: 'process',
    outputs: [
      { id: 'verified', label: 'Verified' },
      { id: 'needs_attention', label: 'Needs attention' },
    ],
    port: (input) => {
      if (input.event !== 'pack_verified') return null;
      return input.kitComplete === true ? 'verified' : 'needs_attention';
    },
    data: (ctx) => ({
      kitComplete: ctx.input.kitComplete === true,
      missingRequiredIds: ctx.input.missingRequiredIds ?? [],
      verifiedBy: ctx.actor.staffId,
    }),
  }),
);
