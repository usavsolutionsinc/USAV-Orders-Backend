/**
 * `ship` — carrier handoff, the graph's terminal step. Domain work is owned
 * by src/lib/shipping + /api/pack/ship (label print → carrier scan). The
 * `shipped` port is intentionally unrouted in the seeded graph: the engine
 * treats a fired port with no edge as terminal, marking the run done. No tap
 * fires this yet; wiring is one tapWorkflow({ event: 'shipped' }) call at
 * the ship mutation.
 */

import { registerNode } from '../registry';
import { stationNode } from './station-node';

registerNode(
  stationNode({
    type: 'ship',
    label: 'Ship',
    icon: 'Truck',
    category: 'fulfill',
    outputs: [{ id: 'shipped', label: 'Shipped' }],
    port: (input) => (input.event === 'shipped' ? 'shipped' : null),
    data: (ctx) => ({
      trackingNumber: ctx.input.trackingNumber ?? null,
    }),
  }),
);
