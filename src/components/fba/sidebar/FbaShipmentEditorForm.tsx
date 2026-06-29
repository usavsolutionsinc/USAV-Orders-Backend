'use client';

import { DndContext, DragOverlay } from '@dnd-kit/core';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, MapPin, Package, Plus, RotateCcw, Search, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { getLast4 } from '@/components/ui/CopyChip';
import { FbaTrackingBundleCard } from '@/components/fba/sidebar/FbaTrackingBundleCard';
import { FbaQtySplitPopover } from '@/components/fba/sidebar/FbaQtySplitPopover';
import { droppableIdForBundle, UNALLOCATED_ID, type FbaShipmentEditorFormProps } from './shipment-editor/shipment-editor-helpers';
import { useShipmentEditor } from './shipment-editor/useShipmentEditor';
import { UnallocatedDropZone } from './shipment-editor/UnallocatedDropZone';
import { FnskuSearchModal } from './shipment-editor/FnskuSearchModal';

export type { FbaShipmentEditorFormProps } from './shipment-editor/shipment-editor-helpers';

/**
 * FBA shipment editor — thin composition shell. All editor state, the multi-step
 * save, undo, FNSKU search/add, bundle CRUD, and drag-and-drop live in
 * {@link useShipmentEditor}; the drop zone + FNSKU modal are presentational
 * components under `./shipment-editor/`.
 */
export function FbaShipmentEditorForm(props: FbaShipmentEditorFormProps) {
  const { shipment, stationTheme = 'green', onClose } = props;
  const c = useShipmentEditor(props);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* Header */}
      <div className="relative z-20 flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-3 py-2">
        <div className="flex items-center gap-2">
          <IconButton type="button" onClick={onClose} ariaLabel="Close editor" icon={<X className="h-3.5 w-3.5 text-gray-600" />} className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200" />
          <div>
            <h2 className="text-caption font-black uppercase tracking-tight text-gray-900">Edit Shipment</h2>
            <p className="text-eyebrow font-bold uppercase tracking-widest text-purple-600">{shipment.shipment_ref}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-mini font-bold tabular-nums text-gray-400">{c.totalAllocated} in boxes · {c.totalUnallocated} loose</p>
        </div>
      </div>

      {/* Selection action bar */}
      <AnimatePresence>
        {c.selectionCount > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden border-b border-blue-200 bg-blue-50"
          >
            <div className="px-3 py-2">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-eyebrow font-black uppercase tracking-wider text-blue-800">
                  {c.selectionCount} selected — move to
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={c.clearSelection} className="h-auto px-0 text-mini font-bold text-blue-500 hover:bg-transparent hover:text-blue-700">
                  Clear
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {c.bundles.map((bundle, idx) => {
                  const hasTracking = bundle.tracking_number.trim().length > 0;
                  return (
                    <Button
                      key={bundle.link_id ?? `action-${idx}`}
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => c.moveSelectedTo(droppableIdForBundle(idx))}
                      className="h-auto gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 hover:bg-gray-50"
                    >
                      {hasTracking ? (
                        <>
                          <MapPin className="h-3 w-3 shrink-0 text-blue-500" />
                          <span className="border-b-2 border-blue-500 pb-0.5 font-mono text-micro font-black tracking-tight leading-none text-gray-900">
                            {getLast4(bundle.tracking_number)}
                          </span>
                        </>
                      ) : (
                        <>
                          <Package className="h-3 w-3 shrink-0 text-gray-500" />
                          <span className="text-eyebrow font-bold uppercase tracking-wider text-gray-700">
                            Box {idx + 1}
                          </span>
                        </>
                      )}
                    </Button>
                  );
                })}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => c.moveSelectedTo(UNALLOCATED_ID)}
                  className="h-auto rounded-md border border-amber-200 bg-white px-2 py-1 text-eyebrow font-bold uppercase tracking-wider text-amber-700 hover:bg-amber-100"
                >
                  Unallocated
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Scrollable body */}
      <div className="relative min-h-0 flex-1 space-y-3 overflow-y-auto bg-white p-3 scrollbar-hide">
        {/* FBA Shipment ID */}
        <div>
          <label className="block text-mini font-black uppercase tracking-widest text-gray-700">FBA Shipment ID</label>
          <input
            type="text" value={c.amazonShipmentId}
            onChange={(e) => c.setAmazonShipmentId(e.target.value.toUpperCase())}
            placeholder="FBA1234ABCD"
            className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 font-mono text-caption font-bold text-gray-900 outline-none transition-all placeholder:text-gray-300 focus:border-purple-400 focus:ring-1 focus:ring-purple-400"
          />
        </div>

        <DndContext sensors={c.sensors} onDragStart={c.handleDragStart} onDragEnd={c.handleDragEnd} onDragCancel={c.handleDragCancel}>
          {/* UPS Tracking section — + button at very top, then boxes */}
          <div className="space-y-2">
            <Button type="button" variant="ghost" size="sm" onClick={c.addBundle}
              icon={<Plus className="h-2.5 w-2.5" />}
              className="h-auto w-full justify-center gap-1 rounded-lg border border-dashed border-gray-300 bg-gray-50/50 px-2 py-1.5 text-eyebrow font-bold uppercase tracking-wider text-gray-500 hover:border-purple-300 hover:bg-purple-50/50 hover:text-purple-600"
            >
              UPS Tracking{c.bundles.length > 0 ? ` (${c.bundles.length})` : ''}
            </Button>

            {c.bundles.map((bundle, idx) => (
              <FbaTrackingBundleCard
                key={bundle.link_id ?? `new-${idx}`}
                bundle={bundle} bundleIndex={idx} droppableId={droppableIdForBundle(idx)} stationTheme={stationTheme}
                selectedIds={c.selectedIds} onToggleSelect={c.toggleSelect} onSelectAllInBundle={c.selectAllInBundle}
                onUpdateTracking={c.updateTrackingNumber} onRemoveBundle={c.removeBundle} onToggleCollapse={c.toggleCollapse}
                onDeallocateItem={c.deallocateItem} onChangeAllocationQty={c.changeAllocationQty}
              />
            ))}
          </div>

          {/* Unallocated at bottom */}
          {c.unallocatedItems.length > 0 && (
            <UnallocatedDropZone
              items={c.unallocatedItems} stationTheme={stationTheme}
              selectedIds={c.selectedIds} onToggleSelect={c.toggleSelect}
              onSelectAllUnallocated={c.selectAllUnallocated} onRemoveItem={c.removeUnallocatedItem}
              moveUndo={c.moveUndo} onRestoreToBundle={c.restoreToBundle}
            />
          )}

          {/* Drag overlay */}
          <DragOverlay dropAnimation={null}>
            {c.activeItem ? (
              <div className="rounded-lg border border-blue-300 bg-blue-50 px-2.5 py-1.5 shadow-md">
                <p className="text-micro font-bold text-gray-900">{c.activeItem.display_title || c.activeItem.fnsku}</p>
                <div className="flex items-center gap-1.5">
                  <p className="font-mono text-eyebrow text-gray-500">{c.activeItem.fnsku}</p>
                  {c.dragCount > 1 && (
                    <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-mini font-black text-white">
                      +{c.dragCount - 1}
                    </span>
                  )}
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* Split popover */}
        <AnimatePresence>
          {c.splitState && (
            <FbaQtySplitPopover itemId={c.splitState.itemId} fnsku={c.splitState.fnsku} maxQty={c.splitState.maxQty} onConfirm={c.confirmSplit} onCancel={c.cancelSplit} />
          )}
        </AnimatePresence>

        {/* Undo */}
        <AnimatePresence>
          {c.visibleUndos.length > 0 && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="space-y-1">
                {c.visibleUndos.map((entry) => (
                  <div key={entry.item_id} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-2.5 py-1.5">
                    <RotateCcw className="h-3 w-3 shrink-0 text-amber-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-eyebrow font-bold text-gray-700">{entry.display_title || entry.fnsku}</p>
                      <p className="font-mono text-mini text-gray-400">{entry.fnsku} · {entry.expected_qty} qty</p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => c.popUndo(entry.item_id)} className="h-auto shrink-0 rounded-md bg-amber-200/80 px-2 py-0.5 text-mini font-black uppercase tracking-wider text-amber-800 hover:bg-amber-300">Undo</Button>
                    <IconButton type="button" onClick={() => c.dismissUndo(entry.item_id)} ariaLabel="Dismiss" icon={<X className="h-2.5 w-2.5" />} className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-amber-400 hover:text-amber-600" />
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* FNSKU search — popup trigger */}
        <Button type="button" variant="ghost" size="sm" onClick={() => c.setFnskuSearchOpen(true)} icon={<Search className="h-2.5 w-2.5" />} className="h-auto gap-1 px-0 text-eyebrow font-bold text-purple-600 hover:bg-transparent hover:text-purple-800">
          Add FNSKU to shipment
        </Button>
      </div>

      {/* FNSKU search popup — portaled to body so it escapes any transformed ancestor */}
      <FnskuSearchModal
        open={c.fnskuSearchOpen}
        onClose={() => c.setFnskuSearchOpen(false)}
        query={c.fnskuQuery}
        onQueryChange={c.setFnskuQuery}
        searchInputRef={c.searchInputRef}
        searching={c.fnskuSearching}
        results={c.fnskuResults}
        items={c.items}
        addingFnsku={c.addingFnsku}
        stationTheme={stationTheme}
        onAddFnsku={c.handleAddFnskuToShipment}
      />

      {/* Footer */}
      <div className="border-t border-gray-200 bg-white px-3 py-2">
        {c.saveError && <p className="mb-1.5 text-micro font-semibold text-red-600">{c.saveError}</p>}
        {/* ds-raw-button: themed via c.chrome.primaryButton (per-staff station theme); no fixed DS variant maps to it */}
        <button type="button" onClick={c.save} disabled={c.saving} className={c.chrome.primaryButton}>
          {c.saving
            ? <span className="flex items-center justify-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /><span className="text-micro">Saving...</span></span>
            : <span className="text-micro">Save Changes</span>}
        </button>
      </div>
    </div>
  );
}
