/**
 * Checklist block — the driving example of the station builder: a generic
 * list of rows with check/act affordances. It doesn't know which integration
 * feeds it; bind it to `po_gmail.unmatched_emails` and it's the incoming
 * email to-do, bind it to `receiving.awaiting_tracking_pos` and it's tier 2
 * of the same plan — one drag and four dropdowns, not a second component.
 *
 * Variants live in configSchema, not as sibling block types:
 *   check_only   — manual tick, no required action
 *   check_act    — a row completes when its done_when action succeeds
 */

import { registerBlock } from './registry';

let registered = false;
export function registerChecklistBlock(): void {
  if (registered) return;
  registered = true;
  registerBlock({
    type: 'checklist',
    label: 'Checklist',
    icon: 'ListChecks',
    category: 'list',
    slots: ['queue'],
    accepts: 'rows',
    roles: [
      { key: 'title', label: 'Title', kind: 'text', required: true },
      { key: 'ref', label: 'Reference (PO/order/SKU…)' },
      { key: 'meta', label: 'Meta line' },
    ],
    configSchema: [
      {
        key: 'variant',
        label: 'Completion',
        kind: 'select',
        options: [
          { value: 'check_act', label: 'Action completes the item' },
          { value: 'check_only', label: 'Manual tick' },
        ],
        default: 'check_act',
      },
      {
        key: 'sort',
        label: 'Sort',
        kind: 'select',
        options: [
          { value: 'newest', label: 'Newest first' },
          { value: 'oldest', label: 'Oldest first' },
        ],
        default: 'newest',
      },
      { key: 'empty_text', label: 'Empty-state text', kind: 'text', default: 'All clear — nothing to do.' },
    ],
    requiredPermissions: [],
    component: () =>
      import('@/components/stations/blocks/ChecklistBlock').then((m) => m.ChecklistBlock),
  });
}
