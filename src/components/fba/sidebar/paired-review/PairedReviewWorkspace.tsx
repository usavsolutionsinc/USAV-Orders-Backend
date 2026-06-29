import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core';
import { AnimatePresence } from 'framer-motion';
import { Check, Plus } from '@/components/Icons';
import type { FbaBoardItem } from '@/components/fba/FbaBoardTable';
import { FbaSelectedLineRow } from '@/components/fba/sidebar/FbaSelectedLineRow';
import { FbaUnallocatedBucket } from '@/components/fba/sidebar/FbaUnallocatedBucket';
import { FbaTrackingBucket } from '@/components/fba/sidebar/FbaTrackingBucket';
import { FbaQtySplitPopover } from '@/components/fba/sidebar/FbaQtySplitPopover';
import { microBadge } from '@/design-system/tokens/typography/presets';
import type { StationTheme } from '@/utils/staff-colors';
import { StickyActionBar } from '@/design-system/components/StickyActionBar';
import { IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import type { PairedReviewController } from './usePairedReview';

/**
 * Wide horizontal kanban for the center crossfade: Unallocated tray + one column
 * per UPS box, FBA ID + selection summary in a top toolbar, Save in a sticky bar.
 */
export function PairedReviewWorkspace({
  c,
  stationTheme,
  selectedItems,
}: {
  c: PairedReviewController;
  stationTheme: StationTheme;
  selectedItems: FbaBoardItem[];
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* Toolbar: FBA Shipment ID + selection summary (Save lives in the
          bottom action bar, like receiving / testing). */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-100 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <p className="shrink-0 text-eyebrow font-black uppercase tracking-widest text-gray-500">
            FBA Shipment ID
          </p>
          <input
            value={c.lockedFbaId || c.amazonShipmentId}
            onChange={(e) => {
              if (c.lockedFbaId) return;
              c.setAmazonShipmentId(e.target.value.toUpperCase());
            }}
            placeholder="FBA1234ABCD"
            disabled={c.saving || Boolean(c.lockedFbaId)}
            className={`${c.chrome.monoInput} max-w-[260px] min-w-0 flex-1 ${c.lockedFbaId ? '!bg-emerald-50 !border-emerald-200 !text-emerald-800' : ''}`}
          />
          {c.lockedFbaId && (
            <HoverTooltip label="Done with this FBA Shipment ID" asChild>
              <IconButton
                type="button"
                icon={<Check className="h-3.5 w-3.5" />}
                ariaLabel="Done — clear FBA Shipment ID"
                onClick={c.handleDismissFbaId}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
              />
            </HoverTooltip>
          )}
        </div>

        {c.hasItems ? (
          <span className="shrink-0 text-micro font-bold uppercase tracking-wider tabular-nums text-gray-500">
            {selectedItems.length} line{selectedItems.length === 1 ? '' : 's'} · {c.totalQty} units
          </span>
        ) : null}
      </div>

      {/* Inline guidance / status (errors render in the bottom action bar). */}
      {(c.activeSplit || c.success) ? (
        <div className="shrink-0 space-y-1 px-4 pt-2">
          {c.activeSplit ? (
            <p className="text-eyebrow font-semibold leading-snug text-amber-800">
              If you change this FBA ID from the prefilled value, Save creates a new active shipment for these
              FNSKUs with this Amazon ID and UPS; the original card keeps its FBA ID for remaining lines.
            </p>
          ) : null}
          {c.success ? <p className={`${microBadge} tracking-wider text-emerald-600`}>{c.success}</p> : null}
        </div>
      ) : null}

      {/* Kanban: Unallocated tray + one column per UPS box + add-box */}
      <div ref={c.kanbanScrollRef} className="relative min-h-0 flex-1 overflow-auto">
        {c.hasItems ? (
          <DndContext
            sensors={c.sensors}
            collisionDetection={closestCenter}
            onDragStart={c.handleDragStart}
            onDragEnd={c.handleDragEnd}
            onDragCancel={c.handleDragCancel}
          >
            <div className="flex h-full min-w-max items-start gap-3 p-4">
              <div className="w-72 shrink-0">
                <FbaUnallocatedBucket
                  allocations={c.allocations.unallocated}
                  selectedItems={selectedItems}
                  stationTheme={stationTheme}
                  onQtyChange={c.handleQtyChange}
                  onRemoveItem={c.removeSelectedItem}
                />
              </div>

              {c.allocations.buckets.map((bucket) => (
                <div key={bucket.bucketId} className="w-72 shrink-0">
                  <FbaTrackingBucket
                    bucket={bucket}
                    selectedItems={selectedItems}
                    stationTheme={stationTheme}
                    saving={c.saving}
                    onTrackingChange={c.handleTrackingChange}
                    onQtyChange={c.handleQtyChange}
                    onRemoveItem={c.removeSelectedItem}
                    onToggleCollapse={c.handleToggleCollapse}
                    onDelete={c.handleDeleteBucket}
                  />
                </div>
              ))}

              {/* ds-raw-button: full-height vertical (icon-over-label) dashed drop-tile; Button is a horizontal pill */}
              <button
                type="button"
                onClick={c.addBucket}
                disabled={c.saving}
                className="flex w-44 shrink-0 flex-col items-center justify-center gap-1.5 self-stretch rounded-lg border border-dashed border-gray-300 py-6 text-micro font-bold uppercase tracking-wider text-gray-500 transition-colors hover:border-blue-400 hover:bg-blue-50/50 hover:text-blue-600 disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
                Add UPS Box
              </button>
            </div>

            <DragOverlay>
              {c.activeItem ? (
                <div className="rounded-lg border border-blue-300 bg-white/95 shadow-lg">
                  <FbaSelectedLineRow
                    displayTitle={c.activeItem.display_title || 'No title'}
                    fnsku={String(c.activeItem.fnsku || '').toUpperCase()}
                    stationTheme={stationTheme}
                    checked
                    checkboxDisabled
                    rightSlot={null}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : c.lockedFbaId ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className={`${microBadge} tracking-wider text-emerald-600`}>
              Select more packed items to add another UPS tracking to {c.lockedFbaId}
            </p>
          </div>
        ) : null}

        {/* Qty split popover */}
        <AnimatePresence>
          {c.splitState && (
            <FbaQtySplitPopover
              itemId={c.splitState.itemId}
              fnsku={c.splitState.fnsku}
              maxQty={c.splitState.maxQty}
              onConfirm={c.confirmSplit}
              onCancel={c.cancelSplit}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Bottom action bar — same StickyActionBar chrome as receiving / testing. */}
      <StickyActionBar
        primaryFullWidth
        maxWidth="max-w-none"
        error={c.error || undefined}
        primary={{
          label: c.lockedFbaId ? 'Save UPS Tracking' : 'Save Shipment + UPS',
          onClick: () => void c.handleSaveAll(),
          disabled: !c.hasAllocatedItems,
          isLoading: c.saving,
          toneClasses: { bg: c.themeColors.bg, hover: c.themeColors.hover },
        }}
      />
    </div>
  );
}
