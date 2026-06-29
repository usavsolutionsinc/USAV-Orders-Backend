'use client';

import { useDraggable } from '@dnd-kit/core';
import { GripVertical } from '@/components/Icons';
import {
  buildBoardDragPayload,
  collectBoardRowsForActiveShipmentSidebarDrag,
  FBA_BOARD_DND_TYPE,
  type FbaBoardDragRowSnapshot,
} from '@/lib/fba/board-drag';
import { FbaSelectedLineRow } from '@/components/fba/sidebar/FbaSelectedLineRow';
import { PrintTableCheckbox } from '@/components/fba/table/Checkbox';
import type { FbaSelectedLineRowProps } from '@/components/fba/sidebar/FbaSelectedLineRow';

export interface FbaDraggableLineRowProps extends FbaSelectedLineRowProps {
  dragId: string;
  dragData: { itemId: number; sourceContainer: string };
  /** When true, the checkbox acts as a multi-select toggle (blue). */
  selected?: boolean;
  onToggleSelect?: () => void;
  /**
   * When set together with bucketItemIds, the grip participates in combine-review buckets
   * via dnd-kit and also emits an HTML5 drag payload for merging into expanded Active shipments
   * tracking rows (`application/x-usav-fba-board-drag`).
   */
  sidebarBoardSnapshots?: ReadonlyArray<FbaBoardDragRowSnapshot & { qty?: number }>;
  bucketItemIds?: ReadonlySet<number>;
}

export function FbaDraggableLineRow({
  dragId,
  dragData,
  checked = true,
  stationTheme = 'green',
  onCheckedChange,
  selected,
  onToggleSelect,
  sidebarBoardSnapshots,
  bucketItemIds,
  ...rowProps
}: FbaDraggableLineRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: dragData,
  });

  const html5SidebarDragActive =
    Boolean(sidebarBoardSnapshots?.length && bucketItemIds?.size && bucketItemIds.size > 0);

  const handleNativeDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
    if (!html5SidebarDragActive || !sidebarBoardSnapshots || !bucketItemIds) return;
    const collected = collectBoardRowsForActiveShipmentSidebarDrag(
      dragData.itemId,
      sidebarBoardSnapshots,
      bucketItemIds,
    );
    if (collected.length === 0) {
      e.preventDefault();
      return;
    }
    try {
      e.dataTransfer.setData(FBA_BOARD_DND_TYPE, buildBoardDragPayload(collected));
      e.dataTransfer.effectAllowed = 'copy';
    } catch {
      e.preventDefault();
    }
  };

  // When dragging: hide the source row entirely so only the DragOverlay is visible.
  // We intentionally skip the dnd-kit transform because the overlay handles movement.
  const style = isDragging ? { visibility: 'hidden' as const } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={selected ? 'bg-gray-50/80' : undefined}
    >
      <FbaSelectedLineRow
        {...rowProps}
        checked={checked}
        stationTheme={stationTheme}
        onCheckedChange={onCheckedChange}
        leadingSlot={
          <div className="flex flex-col items-center gap-1">
            <PrintTableCheckbox
              checked={selected ?? checked}
              stationTheme={stationTheme}
              onChange={() => {
                if (onToggleSelect) onToggleSelect();
                else onCheckedChange?.(!checked);
              }}
              label={
                selected != null
                  ? selected
                    ? 'Deselect'
                    : 'Select'
                  : checked
                    ? 'Remove item'
                    : 'Restore item'
              }
            />
            <button
              ref={setActivatorNodeRef}
              type="button"
              draggable={html5SidebarDragActive}
              onDragStart={html5SidebarDragActive ? handleNativeDragStart : undefined}
              className="ds-raw-button flex h-4 w-4 cursor-grab items-center justify-center rounded text-gray-300 transition-colors hover:text-gray-500 active:cursor-grabbing"
              aria-label="Drag to move item"
              {...listeners}
              {...attributes}
            >
              <GripVertical className="h-3 w-3" />
            </button>
          </div>
        }
      />
    </div>
  );
}
