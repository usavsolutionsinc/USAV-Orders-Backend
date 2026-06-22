import { useDroppable } from '@dnd-kit/core';
import { RotateCcw } from '@/components/Icons';
import { FbaDraggableLineRow } from '@/components/fba/sidebar/FbaDraggableLineRow';
import { FbaQtyStepper } from '@/components/fba/sidebar/FbaQtyStepper';
import { PrintTableCheckbox } from '@/components/fba/table/Checkbox';
import type { StationTheme } from '@/utils/staff-colors';
import type { ShipmentCardItem } from '@/lib/fba/types';
import { UNALLOCATED_ID, type MoveUndoEntry } from './shipment-editor-helpers';

// ── Unallocated drop zone ────────────────────────────────────────────────────

export function UnallocatedDropZone({
  items,
  stationTheme,
  selectedIds,
  onToggleSelect,
  onSelectAllUnallocated,
  onRemoveItem,
  moveUndo,
  onRestoreToBundle,
}: {
  items: ShipmentCardItem[];
  stationTheme: StationTheme;
  selectedIds: Set<number>;
  onToggleSelect: (itemId: number) => void;
  onSelectAllUnallocated: () => void;
  onRemoveItem: (itemId: number) => void;
  moveUndo: Map<number, MoveUndoEntry>;
  onRestoreToBundle: (itemId: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: UNALLOCATED_ID });
  const totalUnits = items.reduce((s, i) => s + i.expected_qty, 0);
  const allSelected = items.length > 0 && items.every((i) => selectedIds.has(i.item_id));
  const someSelected = items.some((i) => selectedIds.has(i.item_id));

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border transition-colors ${
        isOver
          ? 'border-dashed border-amber-400 bg-amber-50/40'
          : 'border-gray-200 bg-gray-50/30'
      }`}
    >
      {/* Header — matches bundle card + item row grid so checkboxes align vertically */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 px-3 py-1.5">
        <div className="flex h-5 w-5 items-center justify-center">
          {items.length > 0 ? (
            <PrintTableCheckbox
              checked={allSelected}
              indeterminate={someSelected && !allSelected}
              stationTheme={stationTheme}
              onChange={onSelectAllUnallocated}
              label={allSelected ? 'Deselect all unallocated' : 'Select all unallocated'}
            />
          ) : null}
        </div>
        <p className="text-mini font-black uppercase tracking-wider text-amber-700">
          Unallocated
        </p>
        {items.length > 0 && (
          <span className="shrink-0 text-mini font-black tabular-nums text-gray-400">
            {items.length} · {totalUnits}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="border-t border-gray-100 px-3 py-2">
          <p className="text-center text-eyebrow font-bold text-gray-300">
            All items allocated to boxes
          </p>
        </div>
      ) : (
        <div className="border-t border-gray-100">
          {items.map((item) => {
            const pendingUndo = moveUndo.get(item.item_id);
            return (
              <FbaDraggableLineRow
                key={item.item_id}
                dragId={`editor-drag-${item.item_id}-unallocated`}
                dragData={{ itemId: item.item_id, sourceContainer: UNALLOCATED_ID }}
                displayTitle={item.display_title || 'No title'}
                fnsku={String(item.fnsku || '').toUpperCase()}
                stationTheme={stationTheme}
                checked
                selected={selectedIds.has(item.item_id)}
                onToggleSelect={() => onToggleSelect(item.item_id)}
                onCheckedChange={() => onRemoveItem(item.item_id)}
                rightSlot={
                  <div className="flex items-center gap-1">
                    {pendingUndo && (
                      <button
                        type="button"
                        onClick={() => onRestoreToBundle(item.item_id)}
                        className="flex h-5 items-center gap-0.5 rounded-md border border-amber-200 bg-amber-50 px-1.5 text-mini font-black uppercase tracking-wider text-amber-700 transition-colors hover:border-amber-300 hover:bg-amber-100"
                        aria-label="Undo move — return to previous box"
                        title="Return to previous box"
                      >
                        <RotateCcw className="h-2.5 w-2.5" />
                        Undo
                      </button>
                    )}
                    <FbaQtyStepper
                      value={item.expected_qty}
                      onChange={() => {}}
                      fnsku={item.fnsku}
                    />
                  </div>
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
