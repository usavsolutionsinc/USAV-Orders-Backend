'use client';

/**
 * Rail edit-mode bulk action bar — auto-shows while rows are checked. "Clear"
 * empties the selection via the shared toggle-all event (RAIL_EDIT_SCOPE).
 * Thin wrapper over the design-system SelectionActionBar so the panel render
 * stays declarative. Extracted from ReceivingSidebarPanel.
 *
 * Phase 4: the primary action is a reversible per-staff DISMISS (hide from my
 * rail), not a destructive delete — so it reads neutral (gray, no trash icon).
 */

import { X } from '@/components/Icons';
import { SelectionActionBar } from '@/design-system/components/SelectionActionBar';
import { RAIL_EDIT_SCOPE } from '@/components/sidebar/receiving/useRailEditMode';

interface ReceivingBulkActionBarProps {
  selectedIds: number[];
  onDismiss: (ids: number[]) => void;
  busy: boolean;
}

export function ReceivingBulkActionBar({
  selectedIds,
  onDismiss,
  busy,
}: ReceivingBulkActionBarProps) {
  return (
    <SelectionActionBar<number>
      scope={RAIL_EDIT_SCOPE}
      rows={selectedIds}
      primaryLabel="Dismiss"
      primaryIcon={<X className="h-3.5 w-3.5" />}
      primaryTone="gray"
      onPrimary={onDismiss}
      primaryDisabled={busy}
      primaryLoading={busy}
      primaryTitle="Hide the selected rows from your rail (reversible)"
    />
  );
}
