'use client';

import { MobileSelectionBar, type MobileSelectionAction } from './MobileSelectionBar';
import { useTableSelectionTotal } from '@/hooks/useTableSelection';
import { emitToggleAll } from '@/lib/selection/table-selection';
import {
  resolveSelectionAction,
  type SelectionAction,
} from '@/lib/selection/selection-actions';

interface ContextualSelectionBarProps<T> {
  /** Must match the `scope` passed to the table + `useTableSelection`. */
  scope: string;
  /** Selected rows, from `useTableSelection(scope)`. */
  rows: T[];
  /** Per-page contextual actions. Each enabled action renders as one icon in
   *  the glass capsule (icon-only — the label drives the tooltip/aria). */
  actions: SelectionAction<T>[];
}

/**
 * Contextual bulk-action bar — the page-agnostic shell that renders a
 * {@link SelectionAction} set as the liquid-glass {@link MobileSelectionBar}
 * capsule whenever rows are selected.
 *
 * It maps each action to an icon button (dropping any whose selection-count /
 * predicate constraints aren't met, so the icon row stays free of dead
 * buttons), and wires the capsule's select-all ring + clear to the shared
 * toggle-all event bus. A page only declares *what* the actions are, not the
 * chrome. Render it inside the table's `relative` region — the capsule pins to
 * the bottom and auto-shows when rows are selected.
 */
export function ContextualSelectionBar<T>({
  scope,
  rows,
  actions,
}: ContextualSelectionBarProps<T>) {
  const total = useTableSelectionTotal(scope);

  if (actions.length === 0) return null;

  const count = rows.length;
  const allSelected = total > 0 && count >= total;

  // Only surface actions that can actually fire for the current selection
  // (e.g. the single-row "ticket" icon shows at count 1; perpetually-disabled
  // "coming soon" actions stay hidden) — the icon-only capsule has no disabled
  // affordance, so we filter rather than render dead buttons.
  const capsuleActions: MobileSelectionAction[] = actions
    .filter((a) => !resolveSelectionAction(a, rows).disabled)
    .map((a) => ({
      key: a.key,
      label: a.label,
      tone: a.tone === 'red' ? 'danger' : 'default',
      icon: () => <>{a.icon}</>,
      onTap: () => {
        void a.run(rows);
      },
    }));

  return (
    <MobileSelectionBar
      count={count}
      total={total}
      allSelected={allSelected}
      onToggleAll={() => emitToggleAll(scope, allSelected ? 'none' : 'all')}
      onClear={() => emitToggleAll(scope, 'none')}
      actions={capsuleActions}
    />
  );
}

export default ContextualSelectionBar;
