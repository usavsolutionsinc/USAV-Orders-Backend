'use client';

import { SelectionActionBar } from './SelectionActionBar';
import {
  resolveSelectionAction,
  type SelectionAction,
} from '@/lib/selection/selection-actions';

interface ContextualSelectionBarProps<T> {
  /** Must match the `scope` passed to the table + `useTableSelection`. */
  scope: string;
  /** Selected rows, from `useTableSelection(scope)`. */
  rows: T[];
  /** Per-page contextual actions. The first `primary` action (or the first
   *  action) becomes the CTA; the rest fill the overflow menu. */
  actions: SelectionAction<T>[];
}

/**
 * Contextual bulk-action bar — the page-agnostic shell that renders a
 * {@link SelectionAction} set on top of {@link SelectionActionBar}.
 *
 * It picks the primary CTA, pushes the remaining actions into the overflow
 * menu, and applies each action's selection-count / predicate constraints
 * (disabling with a tooltip reason) so a page only has to declare *what* the
 * actions are, not wire the chrome. Render it inside the table's `relative`
 * region — it pins to the bottom and auto-shows when rows are selected.
 */
export function ContextualSelectionBar<T>({
  scope,
  rows,
  actions,
}: ContextualSelectionBarProps<T>) {
  if (actions.length === 0) return null;

  const primary = actions.find((a) => a.primary) ?? actions[0];
  const others = actions.filter((a) => a !== primary);

  const primaryResolved = resolveSelectionAction(primary, rows);

  const menu = others.map((a) => {
    const { disabled, reason } = resolveSelectionAction(a, rows);
    return {
      label: a.label,
      icon: a.icon,
      disabled,
      title: disabled ? reason : a.label,
      onClick: (r: T[]) => {
        if (!disabled) void a.run(r);
      },
    };
  });

  return (
    <SelectionActionBar
      scope={scope}
      rows={rows}
      primaryLabel={primary.label}
      primaryIcon={primary.icon}
      primaryTone={primary.tone ?? 'blue'}
      primaryDisabled={primaryResolved.disabled}
      primaryTitle={primaryResolved.disabled ? primaryResolved.reason : primary.label}
      onPrimary={(r) => {
        if (!primaryResolved.disabled) void primary.run(r);
      }}
      actions={menu}
    />
  );
}

export default ContextualSelectionBar;
