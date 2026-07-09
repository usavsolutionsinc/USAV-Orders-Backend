import { useDroppable } from '@dnd-kit/core';
import { RotateCcw } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
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
          : 'border-border-soft bg-surface-canvas/30'
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
          <span className="shrink-0 text-mini font-black tabular-nums text-text-faint">
            {items.length} · {totalUnits}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="border-t border-border-hairline px-3 py-2">
          <p className="text-center text-eyebrow font-bold text-text-faint">
            All items allocated to boxes
          </p>
        </div>
      ) : (
        <div className="border-t border-border-hairline">
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
                      <HoverTooltip label="Return to previous box" asChild>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<RotateCcw className="h-2.5 w-2.5" />}
                          onClick={() => onRestoreToBundle(item.item_id)}
                          className="h-5 gap-0.5 rounded-md border border-amber-200 bg-amber-50 px-1.5 text-mini font-black uppercase tracking-wider text-amber-700 hover:border-amber-300 hover:bg-amber-100"
                          ariaLabel="Undo move — return to previous box"
                        >
                          Undo
                        </Button>
                      </HoverTooltip>
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
