import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core';
import { AnimatePresence } from 'framer-motion';
import { Check, ChevronUp, Loader2, Plus } from '@/components/Icons';
import type { FbaBoardItem } from '@/components/fba/FbaBoardTable';
import { FbaSelectedLineRow } from '@/components/fba/sidebar/FbaSelectedLineRow';
import { FbaUnallocatedBucket } from '@/components/fba/sidebar/FbaUnallocatedBucket';
import { FbaTrackingBucket } from '@/components/fba/sidebar/FbaTrackingBucket';
import { FbaQtySplitPopover } from '@/components/fba/sidebar/FbaQtySplitPopover';
import { microBadge } from '@/design-system/tokens/typography/presets';
import type { StationTheme } from '@/utils/staff-colors';
import type { PairedReviewController } from './usePairedReview';

/** Narrow vertical stack for the sidebar (legacy) combine-review layout. */
export function PairedReviewPanelLayout({
  c,
  stationTheme,
  selectedItems,
  onToggleExpanded,
}: {
  c: PairedReviewController;
  stationTheme: StationTheme;
  selectedItems: FbaBoardItem[];
  onToggleExpanded?: () => void;
}) {
  return (
    <div className="border-b border-gray-100">
      {onToggleExpanded ? (
        <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
          <p className="text-micro font-black uppercase tracking-widest text-gray-500">Combine review</p>
          <button
            type="button"
            onClick={onToggleExpanded}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Collapse combine review"
            title="Collapse"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <div className="space-y-2 px-3 pb-3 pt-1">
        {/* FBA Shipment ID — parent card header */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-eyebrow font-black uppercase tracking-widest text-gray-500">FBA Shipment ID</p>
            {c.lockedFbaId && (
              <button
                type="button"
                onClick={c.handleDismissFbaId}
                className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 transition-colors hover:bg-emerald-200"
                aria-label="Done — clear FBA Shipment ID"
                title="Done with this FBA Shipment ID"
              >
                <Check className="h-3 w-3" />
              </button>
            )}
          </div>
          <input
            value={c.lockedFbaId || c.amazonShipmentId}
            onChange={(e) => {
              if (c.lockedFbaId) return;
              c.setAmazonShipmentId(e.target.value.toUpperCase());
            }}
            placeholder="FBA1234ABCD"
            disabled={c.saving || Boolean(c.lockedFbaId)}
            className={`${c.chrome.monoInput} ${c.lockedFbaId ? '!bg-emerald-50 !border-emerald-200 !text-emerald-800' : ''}`}
          />
          {c.activeSplit ? (
            <p className="mt-1.5 text-eyebrow font-semibold leading-snug text-amber-800">
              If you change this FBA ID from the prefilled value, Save creates a new active shipment for these
              FNSKUs with this Amazon ID and UPS; the original card keeps its FBA ID for remaining lines.
            </p>
          ) : null}
        </div>

        {/* Drag-and-drop hierarchy: Unallocated + UPS Tracking Buckets */}
        {c.hasItems ? (
          <div className="relative space-y-2">
            <DndContext
              sensors={c.sensors}
              collisionDetection={closestCenter}
              onDragStart={c.handleDragStart}
              onDragEnd={c.handleDragEnd}
              onDragCancel={c.handleDragCancel}
            >
              <FbaUnallocatedBucket
                allocations={c.allocations.unallocated}
                selectedItems={selectedItems}
                stationTheme={stationTheme}
                onQtyChange={c.handleQtyChange}
                onRemoveItem={c.removeSelectedItem}
              />

              {c.allocations.buckets.map((bucket) => (
                <FbaTrackingBucket
                  key={bucket.bucketId}
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
              ))}

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
        ) : c.lockedFbaId ? (
          <p className={`${microBadge} tracking-wider text-emerald-600`}>
            Select more items to add another UPS tracking to {c.lockedFbaId}
          </p>
        ) : null}

        {/* Add UPS Tracking bucket button */}
        {c.hasItems ? (
          <button
            type="button"
            onClick={c.addBucket}
            disabled={c.saving}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 text-micro font-bold uppercase tracking-wider text-gray-500 transition-colors hover:border-blue-400 hover:bg-blue-50/50 hover:text-blue-600 disabled:opacity-40"
          >
            <Plus className="h-3 w-3" />
            Add UPS Tracking Box
          </button>
        ) : null}

        {/* Error / success messages */}
        {c.error && <p className={`${microBadge} tracking-wider text-red-600`}>{c.error}</p>}
        {c.success && <p className={`${microBadge} tracking-wider text-emerald-600`}>{c.success}</p>}

        {/* Save button */}
        {c.hasAllocatedItems ? (
          <button
            type="button"
            onClick={() => void c.handleSaveAll()}
            disabled={c.saving}
            className={`flex h-10 items-center justify-center gap-1.5 ${c.chrome.primaryButton}`}
          >
            {c.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white" /> : null}
            {c.lockedFbaId ? 'Save UPS Tracking' : 'Save Shipment + UPS'}
          </button>
        ) : c.hasItems && c.allocations.buckets.length === 0 ? (
          <p className={`${microBadge} text-center tracking-wider text-gray-400`}>
            Add a UPS tracking box, then drag items into it
          </p>
        ) : null}
      </div>
    </div>
  );
}
