/**
 * `pack` — allocation → pick → pack bench. Domain work is owned by
 * src/lib/inventory/allocate + src/lib/picking + /api/pack/ship
 * (order_unit_allocations.state ALLOCATED → PICKED → PACKED). No tap fires
 * this yet (Phase 1 scope ends at the verdict/repair taps); wiring is one
 * tapWorkflow({ event: 'packed' }) call at the pack-complete mutation.
 */

import { registerNode } from '../registry';
import { stationNode } from './station-node';

registerNode(
  stationNode({
    type: 'pack',
    label: 'Pack',
    icon: 'Package',
    category: 'fulfill',
    outputs: [{ id: 'packed', label: 'Packed' }],
    port: (input) => (input.event === 'packed' ? 'packed' : null),
    data: (ctx) => ({
      shipmentId: ctx.input.shipmentId ?? null,
      packedBy: ctx.actor.staffId,
    }),
  }),
);
