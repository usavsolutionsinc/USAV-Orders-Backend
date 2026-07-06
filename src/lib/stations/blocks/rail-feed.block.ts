/**
 * Rail-feed block — a read-oriented worklist rail for the queue slot. Unlike
 * Checklist (check/act to-do), this renders a selectable list: title → ref
 * chips → meta, newest-first, clicking a row dispatches a `station:select`
 * CustomEvent `{ id }` the host surface uses to open the record. Consumes rows
 * from any bound source; never fetches or knows the integration.
 */

import { registerBlock } from './registry';

let registered = false;
export function registerRailFeedBlock(): void {
  if (registered) return;
  registered = true;
  registerBlock({
    type: 'rail_feed',
    label: 'Worklist rail',
    icon: 'List',
    category: 'list',
    slots: ['queue'],
    accepts: 'rows',
    roles: [
      { key: 'title', label: 'Title', kind: 'text', required: true },
      { key: 'ref', label: 'Reference (PO / tracking / SKU…)' },
      { key: 'meta', label: 'Meta line' },
    ],
    configSchema: [
      { key: 'empty_text', label: 'Empty-state text', kind: 'text', default: 'Nothing in the queue.' },
      {
        key: 'show_count',
        label: 'Show count',
        kind: 'toggle',
        default: true,
      },
    ],
    requiredPermissions: [],
    component: () => import('@/components/stations/blocks/RailFeedBlock').then((m) => m.RailFeedBlock),
  });
}
