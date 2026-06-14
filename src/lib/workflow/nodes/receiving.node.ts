/**
 * `receiving` — graph entry node. The domain work (serial_units row, stock
 * ledger, RECEIVED inventory event) is owned by src/lib/receiving
 * (receiveLineUnits / attachSerialToLine); the receiving routes tap
 * `unit_received` after commit, which both enrolls the unit here and fires
 * the `received` port. Stage span: EXPECTED ⓪ → UNBOXED ③ (workflow-stages.ts).
 */

import { registerNode } from '../registry';
import { stationNode } from './station-node';

registerNode(
  stationNode({
    type: 'receiving',
    label: 'Receive',
    icon: 'PackageOpen',
    category: 'intake',
    outputs: [{ id: 'received', label: 'Received' }],
    port: (input) => (input.event === 'unit_received' ? 'received' : null),
    data: (ctx) => ({
      receivingLineId: ctx.input.receivingLineId ?? null,
      receivedBy: ctx.actor.staffId,
    }),
  }),
);
