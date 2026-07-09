'use client';

import { Pencil } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { ToolbarButton } from '@/components/ui/ToolbarButton';

/**
 * In-board "Select" toggle — arms pencil multi-select for a board's tables. It
 * lives in the board header's top-right control cluster (beside the columns
 * config), the industry-standard home for a table's own bulk-select affordance,
 * and replaces the global-header pencil for the dashboard order boards. It renders
 * through the shared {@link ToolbarButton} so it matches every other toolbar
 * control (rounded, soft-bordered, solid-blue when armed).
 *
 * The toggle only flips select-mode on/off — the owning page still holds the
 * selection state, the shared selection scope, and the floating action bar.
 */
export function BoardSelectToggle({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <HoverTooltip label={active ? 'Done selecting' : 'Select rows'} focusable={false} asChild>
      <ToolbarButton
        iconOnly
        active={active}
        onClick={onToggle}
        aria-pressed={active}
        aria-label={active ? 'Done selecting' : 'Select rows'}
      >
        <Pencil className="h-4 w-4" />
      </ToolbarButton>
    </HoverTooltip>
  );
}
