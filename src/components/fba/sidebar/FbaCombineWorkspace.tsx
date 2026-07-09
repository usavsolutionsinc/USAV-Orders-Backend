'use client';

import { X } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { FbaPairedReviewPanel } from '@/components/fba/sidebar/FbaPairedReviewPanel';
import type { FbaBoardItem } from '@/components/fba/FbaBoardTable';
import type { StationTheme } from '@/utils/staff-colors';
import { FBA_BOARD_TOGGLE_ALL } from '@/lib/fba/events';

interface FbaCombineWorkspaceProps {
  selectedItems: FbaBoardItem[];
  stationTheme?: StationTheme;
  onClose: () => void;
}

/**
 * Center workspace that crossfades over the board on the combine page.
 *
 * It mirrors receiving's selected-line workspace: the "active entity" is the
 * in-progress FBA shipment. Pick packed items from the sidebar Packed rail (or
 * board checkboxes) → they land in the kanban builder; drag them into UPS-box
 * columns under one FBA Shipment ID. Existing/combined shipments are browsed
 * and edited from the sidebar Recent tab, not here.
 */
export function FbaCombineWorkspace({
  selectedItems,
  stationTheme = 'green',
  onClose,
}: FbaCombineWorkspaceProps) {
  const handleClose = () => {
    // Clearing the board selection crossfades us back to the board.
    window.dispatchEvent(new CustomEvent(FBA_BOARD_TOGGLE_ALL, { detail: 'none' }));
    onClose();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-card">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border-hairline px-4 py-2.5">
        <p className="text-micro font-black uppercase tracking-widest text-text-soft">Combine</p>
        <HoverTooltip label="Back to board" asChild>
          <IconButton
            icon={<X className="h-4 w-4" />}
            onClick={handleClose}
            className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-sunken"
            ariaLabel="Close — back to board"
          />
        </HoverTooltip>
      </header>

      <div className="min-h-0 flex-1">
        <FbaPairedReviewPanel
          selectedItems={selectedItems}
          stationTheme={stationTheme}
          layout="workspace"
        />
      </div>
    </div>
  );
}
