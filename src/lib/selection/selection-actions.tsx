import type { ReactNode } from 'react';
import type { StickyActionTone } from '@/design-system/components/StickyActionBar';

/**
 * One contextual bulk action for a selection of table rows.
 *
 * A page (receiving history, testing history, …) declares an array of these
 * and hands it to {@link ContextualSelectionBar}. The bar picks the `primary`
 * one for the big CTA, drops the rest into the overflow menu, and disables any
 * action whose selection-count / predicate constraints aren't met — so the
 * contextual logic lives next to each feature while the bar stays generic.
 */
export interface SelectionAction<T> {
  /** Stable identity for React keys + analytics. */
  key: string;
  label: string;
  icon?: ReactNode;
  tone?: StickyActionTone;
  /** Marks the CTA. The first `primary` action becomes the big button; the
   *  remainder render in the overflow menu in declaration order. */
  primary?: boolean;
  /** Minimum selected rows for the action to fire. Defaults to 1. */
  minSelected?: number;
  /** Maximum selected rows — e.g. `1` for single-row flows like a claim. */
  maxSelected?: number;
  /** Extra gate beyond the count constraints (e.g. "all share a carton"). */
  enabled?: (rows: T[]) => boolean;
  /** Tooltip shown when the action is disabled, explaining why. */
  disabledReason?: string;
  run: (rows: T[]) => void | Promise<void>;
}

export interface ResolvedSelectionAction<T> {
  action: SelectionAction<T>;
  disabled: boolean;
  /** Why it's disabled (for the tooltip), or undefined when enabled. */
  reason?: string;
}

/**
 * Apply an action's count + predicate constraints against the current
 * selection, returning whether it's disabled and a human reason for the
 * tooltip. Pure — safe to call on every render.
 */
export function resolveSelectionAction<T>(
  action: SelectionAction<T>,
  rows: T[],
): ResolvedSelectionAction<T> {
  const n = rows.length;
  const min = action.minSelected ?? 1;

  if (n < min) {
    return {
      action,
      disabled: true,
      reason: action.disabledReason ?? `Select at least ${min}`,
    };
  }
  if (action.maxSelected != null && n > action.maxSelected) {
    return {
      action,
      disabled: true,
      reason:
        action.disabledReason ??
        (action.maxSelected === 1
          ? 'Select a single row'
          : `Select at most ${action.maxSelected}`),
    };
  }
  if (action.enabled && !action.enabled(rows)) {
    return { action, disabled: true, reason: action.disabledReason };
  }
  return { action, disabled: false };
}
