/**
 * `repair` — failed-unit rework. The domain work (unit_repairs lifecycle,
 * failure-tag resolution, REPAIR_DONE status, REPAIR_COMPLETED event) is
 * owned by src/lib/neon/repairs-queries (openRepair/updateRepair);
 * updateRepair taps `repair_completed` post-commit when a repair lands on
 * status 'completed', firing `repaired` → the graph routes back to
 * inspection for re-test. Repairs that end 'failed'/'scrapped' do NOT fire —
 * the unit stays parked here until a disposition lane exists (future
 * rtv/parts ports).
 */

import { registerNode } from '../registry';
import { stationNode } from './station-node';

registerNode(
  stationNode({
    type: 'repair',
    label: 'Repair',
    icon: 'Wrench',
    category: 'process',
    outputs: [{ id: 'repaired', label: 'Repaired' }],
    port: (input) => (input.event === 'repair_completed' ? 'repaired' : null),
    data: (ctx) => ({
      repairId: ctx.input.repairId ?? null,
      repairedBy: ctx.actor.staffId,
    }),
  }),
);
