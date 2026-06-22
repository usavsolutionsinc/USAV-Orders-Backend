'use client';

/**
 * Rail edit-mode bulk action bar — auto-shows while rows are checked. "Clear"
 * empties the selection via the shared toggle-all event (RAIL_EDIT_SCOPE).
 * Thin wrapper over the design-system SelectionActionBar so the panel render
 * stays declarative. Extracted from ReceivingSidebarPanel.
 */

import { Trash2 } from '@/components/Icons';
import { SelectionActionBar } from '@/design-system/components/SelectionActionBar';
import { RAIL_EDIT_SCOPE } from '@/components/sidebar/receiving/useRailEditMode';

interface ReceivingBulkActionBarProps {
  selectedIds: number[];
  onDelete: (ids: number[]) => void;
  busy: boolean;
}

export function ReceivingBulkActionBar({
  selectedIds,
  onDelete,
  busy,
}: ReceivingBulkActionBarProps) {
  return (
    <SelectionActionBar<number>
      scope={RAIL_EDIT_SCOPE}
      rows={selectedIds}
      primaryLabel="Delete"
      primaryIcon={<Trash2 className="h-3.5 w-3.5" />}
      primaryTone="red"
      onPrimary={onDelete}
      primaryDisabled={busy}
      primaryLoading={busy}
      primaryTitle="Delete the selected rows"
    />
  );
}
