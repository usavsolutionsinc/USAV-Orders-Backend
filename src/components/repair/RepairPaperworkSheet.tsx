'use client';

import { FileText } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

/**
 * Paperwork toggle for the repair intake flow.
 *
 * Acceptance B (P2-RPR-01): the document viewer must be reachable from ANY step.
 * This control lives in the RepairIntakeForm header (present on all four steps), so
 * a customer/tech can review the live repair-service agreement at any point during
 * entry — not only at the review step.
 *
 * It is a *toggle*, not a popover: pressing it swaps the intake body for the exact
 * printed document (RepairServiceForm on RepairPaperworkCanvas, rendered by the parent),
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
    <HoverTooltip label={active ? 'Hide repair paperwork' : 'View repair paperwork'} asChild>
      <IconButton
        icon={<FileText className="h-4 w-4" />}
        onClick={onToggle}
        aria-pressed={active}
        ariaLabel={active ? 'Hide repair paperwork' : 'View repair paperwork'}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
          active
            ? 'border-border-strong bg-surface-inverse text-white'
            : 'border-border-soft text-text-soft hover:border-border-strong hover:text-text-default'
        }`}
      />
    </HoverTooltip>
  );
}
