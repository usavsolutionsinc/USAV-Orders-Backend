/**
 * `returns` — returns / warranty intake-and-triage. The re-entry point for a unit
 * that comes BACK after shipping (customer return, warranty claim). Electronics
 * have high return rates, so modeling the returns tail is part of a complete
 * refurb lifecycle, not an afterthought.
 *
 * A returned unit is triaged to a disposition:
 *   restock → back into the sellable flow (re-QC, re-list)
 *   rtv     → return to vendor / supplier
 *   scrap   → harvest for parts / dispose
 *
 * Thin adapter like every node: a future returns-intake station action (or the
 * existing warranty logger) records the return + taps `return_received` with the
 * triage disposition; this node only routes on it. Domain truth (RMA ref,
 * reason, condition-on-return) lands in inventory_events / warranty tables via
 * that action, never here.
 */

import { registerNode } from '../registry';
import { stationNode } from './station-node';

registerNode(
  stationNode({
    type: 'returns',
    label: 'Returns / Warranty',
    icon: 'RotateCcw',
    category: 'intake',
    outputs: [
      { id: 'restock', label: 'Restock' },
      { id: 'rtv', label: 'Return to vendor' },
      { id: 'scrap', label: 'Scrap / parts' },
    ],
    port: (input) => {
      if (input.event !== 'return_received') return null;
      const d = String(input.disposition ?? '').toLowerCase();
      if (d === 'restock' || d === 'rtv' || d === 'scrap') return d;
      return null;
    },
    data: (ctx) => ({
      disposition: ctx.input.disposition ?? null,
      rmaRef: ctx.input.rmaRef ?? null,
      returnReason: ctx.input.returnReason ?? null,
      triagedBy: ctx.actor.staffId,
    }),
  }),
);
