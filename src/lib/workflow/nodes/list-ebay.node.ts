/**
 * `list_ebay` — channel listing step (the first of the interchangeable
 * channel nodes; each platform gets its own type behind the same contract).
 * Domain work is owned by src/lib/ebay (existing ebay-api client — never
 * Nango for eBay). No tap fires this yet (listing push is deferred), so
 * Phase 1 units accumulate here = the "ready to list" queue in the Live
 * lens. The error lane is the engine's reserved `error` output (parks for
 * triage without an edge), so only `listed` is a declared port.
 */

import { registerNode } from '../registry';
import { stationNode } from './station-node';

registerNode(
  stationNode({
    type: 'list_ebay',
    label: 'List on eBay',
    icon: 'Tag',
    category: 'fulfill',
    outputs: [{ id: 'listed', label: 'Listed' }],
    port: (input) => (input.event === 'listed' ? 'listed' : null),
    data: (ctx) => ({ listingId: ctx.input.listingId ?? null }),
  }),
);
