'use client';

import { FileText } from '@/components/Icons';

/**
 * Paperwork toggle for the repair intake flow.
 *
 * Acceptance B (P2-RPR-01): the document viewer must be reachable from ANY step.
 * This control lives in the RepairIntakeForm header (present on all four steps), so
 * a customer/tech can review the live repair-service agreement at any point during
 * entry — not only at the review step.
 *
 * It is a *toggle*, not a popover: pressing it swaps the intake body for the exact
 * printed document (RepairServiceForm `variant="print"`, rendered by the parent),
 * and pressing again returns to the current step. No dialog / sheet / portal.
 */

interface RepairPaperworkSheetProps {
  /** Whether the paperwork view is currently shown. */
  active: boolean;
  /** Flip between the step body and the document view. */
  onToggle: () => void;
}

export function RepairPaperworkSheet({ active, onToggle }: RepairPaperworkSheetProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={active ? 'Hide repair paperwork' : 'View repair paperwork'}
      title={active ? 'Hide repair paperwork' : 'View repair paperwork'}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
        active
          ? 'border-gray-900 bg-gray-900 text-white'
          : 'border-gray-200 text-gray-500 hover:border-gray-900 hover:text-gray-900'
      }`}
    >
      <FileText className="h-4 w-4" />
    </button>
  );
}
