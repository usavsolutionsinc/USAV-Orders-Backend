/**
 * `list` — generic, channel-agnostic listing node. The multichannel sibling of
 * `list_ebay`: where `list_ebay` is the eBay-specific adapter, `list` carries the
 * target channel in its `config.channel` (e.g. 'ebay' | 'wholesale' | 'amazon' |
 * 'mercari'), so a grade→channel decision can route a unit to the right
 * marketplace from one node type. Used by the electronics-av-refurb template's
 * `list-route` decision (grade A/B → eBay, grade C → wholesale).
 *
 * Fires its `listed` port when a listing action taps `listed` for the unit at
 * this node. Thin adapter — the actual listing write (offer/inventory item) and
 * the LISTED inventory_event are owned by the listing domain + the station/admin
 * action that taps this; the node only advances the graph.
 */

import { registerNode } from '../registry';
import { stationNode } from './station-node';

registerNode(
  stationNode({
    type: 'list',
    label: 'List (multichannel)',
    icon: 'Tag',
    category: 'fulfill',
    outputs: [{ id: 'listed', label: 'Listed' }],
    port: (input) => (input.event === 'listed' ? 'listed' : null),
    data: (ctx) => ({
      channel: ctx.input.channel ?? null,
      listedBy: ctx.actor.staffId,
    }),
  }),
);
