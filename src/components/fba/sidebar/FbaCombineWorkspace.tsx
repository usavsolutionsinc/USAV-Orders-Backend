'use client';

import { X } from '@/components/Icons';
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
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-4 py-2.5">
        <p className="text-micro font-black uppercase tracking-widest text-gray-500">Combine</p>
        <button
          type="button"
          onClick={handleClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          aria-label="Close — back to board"
          title="Back to board"
        >
          <X className="h-4 w-4" />
        </button>
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
