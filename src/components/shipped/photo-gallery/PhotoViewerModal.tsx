import { AnimatePresence, motion } from 'framer-motion';
import { framerTransition } from '@/design-system/foundations/motion-framer';
import { zIndex as zLayer } from '@/design-system/tokens/z-index';
import {
  X, Download, ZoomIn, ZoomOut, ChevronLeft, ChevronRight,
  AlertCircle, Check, Trash2, Link2 as LinkIcon, Plus, Info, RotateCcw, RefreshCw,
  Folder, LayoutDashboard,
} from '../../Icons';
import { PhotoContextPanel } from './PhotoContextPanel';
import type { PhotoItem } from './photo-gallery-utils';
import type { PhotoGalleryController } from './usePhotoGallery';

/** PO#-section for the grouped grid overview. */
interface ViewerGroup {
  key: string;
  label: string;
  items: PhotoItem[];
}

/**
 * Bucket the flat photo list into PO# sections (the same "stack = PO#" model the
 * library folders use), ordered oldest→newest within each section so they read
 * left→right. Items keep their original flat `index` so a tile click drills to
 * the right single image.
 */
function groupViewerItemsByPo(items: PhotoItem[]): ViewerGroup[] {
  const order: string[] = [];
  const map = new Map<string, ViewerGroup>();
  for (const item of items) {
    const ref = item.meta?.poRef?.trim();
    const ticketId = item.meta?.ticketId ?? null;
    const key = ref ? `po:${ref}` : ticketId != null ? `t:${ticketId}` : '__unlinked__';
    const label = ref ? `PO ${ref}` : ticketId != null ? `Ticket #${ticketId}` : 'Unlinked';
    let group = map.get(key);
    if (!group) {
      group = { key, label, items: [] };
      map.set(key, group);
      order.push(key);
    }
    group.items.push(item);
  }
  for (const group of map.values()) {
    group.items.sort((a, b) => (a.meta?.createdAt ?? '').localeCompare(b.meta?.createdAt ?? ''));
  }
  return order.map((key) => map.get(key)!);
}

/** A tile in the grouped grid overview — preloaded thumb + status fallback. */
function ViewerGridTile({ item, onOpen }: { item: PhotoItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-white/5 transition hover:border-white/40 focus:border-white/60 focus:outline-none"
    >
      {item.status === 'loaded' ? (
        <img src={item.url} alt="" className="h-full w-full object-cover transition group-hover:scale-[1.03]" draggable={false} />
      ) : item.status === 'error' ? (
        <div className="flex h-full w-full items-center justify-center bg-red-900/30">
          <AlertCircle className="h-6 w-6 text-red-400" />
        </div>
      ) : (
        <div className="h-full w-full animate-pulse bg-white/10" />
      )}
    </button>
  );
}

/**
 * The grid overview the viewer opens to (when `overview="grid"`): PO#-grouped
 * sections of large tiles on the dark stage. Clicking a tile drills into the
 * single-image view at that photo.
 */
function ViewerGroupedGrid({ g }: { g: PhotoGalleryController }) {
  const groups = groupViewerItemsByPo(g.photoItems);
  return (
    <div className="absolute inset-0 overflow-y-auto px-6 pb-10 pt-24 sm:px-10">
      <div className="mx-auto max-w-6xl space-y-8">
        {groups.map((group) => (
          <section key={group.key}>
            <header className="mb-3 flex items-center gap-2 border-b border-white/10 pb-2">
              <Folder className="h-4 w-4 shrink-0 text-white/50" />
              <span className="truncate text-base font-bold text-white">{group.label}</span>
              <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-xs font-bold tabular-nums text-white/70">
                {group.items.length}
              </span>
            </header>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
              {group.items.map((item) => (
                <ViewerGridTile key={item.index} item={item} onOpen={() => g.openSingleAt(item.index)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Fullscreen lightbox: zoomable image, nav arrows, thumbnail strip, toolbar. */
export function PhotoViewerModal({ g }: { g: PhotoGalleryController }) {
  const { photoItems, currentIndex, zoomLevel } = g;
  // Reset is always shown (fixed-width icon button) so the toolbar never reflows:
  // grayed + disabled at the default view, filled once zoom/rotation is applied.
  const canReset = zoomLevel > 1 || g.rotation !== 0;
  // Info panel rides alongside the stage as a flex sibling (not an overlay) so
  // the stage shrinks and the centered controls/arrows recenter automatically.
  // It applies to a single photo only — never the grid overview.
  const panelVisible = g.hasContext && g.panelOpen && !g.gridMode;
  // Whether a "back to grid" affordance belongs here (we opened on the grid).
  const canBackToGrid = g.overview === 'grid' && !g.gridMode;

  return (
    <motion.div
      data-testid="photo-lightbox"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 flex bg-black/95 backdrop-blur-md"
      style={{ zIndex: zLayer.modal }}
    >
      {/* Stage — image + all floating controls. flex-1 so it yields width to the
          panel; its absolute children stay centered within the visible area. */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
      {/* Top Bar — image controls (counter + zoom) on the left, global actions on
          the right. The close X is NOT here: it's pinned to the WINDOW corner
          below so it never moves when the panel opens. When the panel is closed
          the right group reserves room (pr-20) so it clears that pinned X. */}
      <div className={`absolute top-0 left-0 right-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent py-6 pl-6 z-10 ${panelVisible ? 'pr-6' : 'pr-20'}`}>
        <div className="flex items-center gap-3">
          <div className="px-4 py-2 bg-white/10 backdrop-blur-md rounded-full border border-white/20">
            <span className="text-white text-sm font-black">
              {currentIndex + 1} / {photoItems.length}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canBackToGrid ? (
            <button
              onClick={(e) => { e.stopPropagation(); g.backToGrid(); }}
              className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-3 text-sm font-bold text-white backdrop-blur-md transition-all hover:bg-white/20"
              aria-label="Back to the PO group"
              title="Back to the PO group (Esc)"
            >
              <LayoutDashboard className="h-4 w-4" /> Back
            </button>
          ) : null}

          {/* Zoom · rotate · reset — single-image only (no target in the grid). */}
          {!g.gridMode ? (
          <div className="flex items-center gap-1 rounded-full border border-white/20 bg-white/10 p-1 backdrop-blur-md">
            <button
              onClick={(e) => { e.stopPropagation(); g.zoomOut(); }}
              disabled={zoomLevel <= 1}
              className="rounded-full p-2 text-white transition-all hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Zoom out"
              title="Zoom out (-)"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="min-w-[44px] text-center text-xs font-bold tabular-nums text-white">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); g.zoomIn(); }}
              disabled={zoomLevel >= 3}
              className="rounded-full p-2 text-white transition-all hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Zoom in"
              title="Zoom in (+)"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <div className="mx-0.5 h-5 w-px bg-white/20" aria-hidden="true" />
            <button
              onClick={(e) => { e.stopPropagation(); g.rotateCw(); }}
              className="rounded-full p-2 text-white transition-all hover:bg-white/10"
              aria-label="Rotate 90 degrees"
              title="Rotate (r)"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); g.resetZoom(); }}
              disabled={!canReset}
              className={`ml-0.5 rounded-full p-2 transition-all ${
                canReset ? 'bg-white/20 text-white hover:bg-white/30' : 'text-white/30'
              }`}
              aria-label="Reset view"
              title="Reset (0)"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          ) : null}

          {!g.gridMode ? <div className="mx-1 h-6 w-px bg-white/20" aria-hidden="true" /> : null}

          {g.onAddPhotos && (
            <button
              onClick={(e) => { e.stopPropagation(); g.addPhotosFromViewer(); }}
              className="p-3 bg-white/10 hover:bg-white/20 rounded-full transition-all text-white backdrop-blur-md border border-white/20 hover:border-white/30 hover:scale-110"
              aria-label="Add photos"
              title="Add photos"
            >
              <Plus className="h-5 w-5" />
            </button>
          )}

          <button
            onClick={(e) => { e.stopPropagation(); void g.handleDownloadAll(); }}
            disabled={g.downloadingAll || photoItems.every((p) => p.status === 'error')}
            className="p-3 bg-white/10 hover:bg-white/20 rounded-full transition-all text-white backdrop-blur-md border border-white/20 hover:border-white/30 hover:scale-110 disabled:opacity-50 disabled:hover:scale-100"
            aria-label={`Download all ${photoItems.length} photos`}
            title={g.downloadingAll ? 'Downloading…' : `Download all ${photoItems.length} photos`}
          >
            <Download className="h-5 w-5" />
          </button>

          {g.showCopyLinks ? (
            <button
              onClick={(e) => { e.stopPropagation(); void g.copyAllPhotoUrls(); }}
              disabled={photoItems.length === 0}
              className="p-3 bg-white/10 hover:bg-white/20 rounded-full transition-all text-white backdrop-blur-md border border-white/20 hover:border-white/30 hover:scale-110 disabled:opacity-50 disabled:hover:scale-100"
              aria-label={g.linksCopied ? 'Links copied' : 'Copy all photo links'}
              title={g.linksCopied ? 'Copied' : 'Copy all photo links'}
            >
              {g.linksCopied ? <Check className="h-5 w-5 text-emerald-300" /> : <LinkIcon className="h-5 w-5" />}
            </button>
          ) : null}

          {!g.gridMode && g.canDeleteCurrent && (
            <button
              onClick={(e) => { e.stopPropagation(); g.handleDeleteClick(); }}
              disabled={g.deletingPhoto}
              className={
                g.deleteArmed
                  ? 'flex items-center gap-2 px-4 py-3 rounded-full transition-all text-white backdrop-blur-md border bg-red-500/80 border-red-300 hover:bg-red-500 disabled:opacity-60'
                  : 'p-3 rounded-full transition-all text-white backdrop-blur-md border bg-white/10 hover:bg-red-500/30 border-white/20 hover:border-red-300 hover:scale-110 disabled:opacity-60'
              }
              aria-label={g.deleteArmed ? 'Confirm delete photo' : 'Delete photo'}
              title={g.deleteArmed ? 'Click again to confirm' : 'Delete photo'}
            >
              <Trash2 className="h-5 w-5" />
              {g.deleteArmed && (
                <span className="text-xs font-bold uppercase tracking-wider">
                  {g.deletingPhoto ? 'Deleting…' : 'Confirm'}
                </span>
              )}
            </button>
          )}

          {!g.gridMode && g.hasContext && (
            <button
              onClick={(e) => { e.stopPropagation(); g.togglePanel(); }}
              aria-pressed={g.panelOpen}
              className={
                g.panelOpen
                  ? 'p-3 rounded-full transition-all text-white backdrop-blur-md border bg-blue-500/30 border-blue-300/40 hover:bg-blue-500/40 hover:scale-110'
                  : 'p-3 rounded-full transition-all text-white backdrop-blur-md border bg-white/10 hover:bg-white/20 border-white/20 hover:border-white/30 hover:scale-110'
              }
              aria-label={g.panelOpen ? 'Hide photo details' : 'Show photo details'}
              title="Toggle details (i)"
            >
              <Info className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {g.deleteError && (
        <div
          className="absolute top-24 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-full bg-red-600/90 border border-red-300 text-white text-xs font-bold backdrop-blur-md shadow-lg"
          role="alert"
        >
          {g.deleteError}
        </div>
      )}

      {g.gridMode ? (
        <ViewerGroupedGrid g={g} />
      ) : (
      <>
      {/* Main Photo */}
      <motion.div
        key={currentIndex}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={framerTransition.dropdownOpen}
        className="relative w-full h-full flex items-center justify-center pl-16 pr-16 py-16"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={g.onMouseDown}
        onMouseMove={g.onMouseMove}
        onMouseUp={g.onMouseUp}
        onMouseLeave={g.onMouseUp}
        style={{ cursor: zoomLevel > 1 ? (g.isDragging ? 'grabbing' : 'grab') : 'default' }}
      >
        {photoItems[currentIndex]?.status === 'loaded' ? (
          <motion.img
            src={photoItems[currentIndex].url}
            alt={`Photo ${currentIndex + 1}`}
            className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl select-none"
            style={{ scale: zoomLevel, rotate: g.rotation, x: g.imagePosition.x, y: g.imagePosition.y, maxHeight: '65vh', maxWidth: '48vw' }}
            draggable={false}
          />
        ) : photoItems[currentIndex]?.status === 'error' ? (
          <div className="w-full max-w-2xl h-96 flex flex-col items-center justify-center bg-red-900/20 rounded-2xl border-2 border-red-500/30">
            <AlertCircle className="h-16 w-16 text-red-400 mb-4" />
            <p className="text-red-300 text-lg font-bold">Failed to load image</p>
          </div>
        ) : (
          <div className="w-full max-w-2xl h-96 flex items-center justify-center bg-gray-800/50 rounded-2xl">
            <div className="h-12 w-12 border-4 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
          </div>
        )}
      </motion.div>

      {/* Navigation Arrows */}
      {photoItems.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); g.handlePrevious(); }}
            className="absolute left-8 top-1/2 -translate-y-1/2 p-4 bg-white/10 hover:bg-white/20 rounded-full transition-all text-white backdrop-blur-md border border-white/20 hover:border-white/30 hover:scale-110 z-10"
            aria-label="Previous photo"
            title="Previous (←)"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); g.handleNext(); }}
            className="absolute right-8 top-1/2 -translate-y-1/2 p-4 bg-white/10 hover:bg-white/20 rounded-full transition-all text-white backdrop-blur-md border border-white/20 hover:border-white/30 hover:scale-110 z-10"
            aria-label="Next photo"
            title="Next (→)"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      {/* Thumbnail Strip — portrait thumbs. The pill itself is `w-fit max-w-full
          mx-auto`, so it shrinks to its thumbs and stays centered when they fit,
          and scrolls internally once they exceed the available width. */}
      {photoItems.length > 1 && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 max-w-4xl w-full px-8 z-10">
          <div className="mx-auto w-fit max-w-full overflow-x-auto no-scrollbar rounded-2xl border border-white/20 bg-black/50 p-3 backdrop-blur-md">
            <div className="flex items-center gap-2">
              {photoItems.map((photo, index) => (
                <button
                  key={index}
                  onClick={(e) => { e.stopPropagation(); g.setCurrentIndex(index); g.resetZoom(); }}
                  className={`relative flex-shrink-0 h-20 w-14 overflow-hidden rounded-lg transition-all ${
                    index === currentIndex ? 'ring-3 ring-white shadow-xl scale-105' : 'opacity-60 hover:opacity-100 hover:scale-105'
                  }`}
                >
                  {photo.status === 'loaded' ? (
                    <img src={photo.url} alt={`Thumbnail ${index + 1}`} className="w-full h-full object-cover" />
                  ) : photo.status === 'error' ? (
                    <div className="w-full h-full bg-red-900/50 flex items-center justify-center">
                      <AlertCircle className="h-6 w-6 text-red-400" />
                    </div>
                  ) : (
                    <div className="w-full h-full bg-gray-700 animate-pulse" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      </>
      )}
      </div>
      {/* Info panel — flex sibling of the stage; mount/unmount animated. */}
      <AnimatePresence initial={false}>
        {panelVisible ? <PhotoContextPanel photo={photoItems[currentIndex]} /> : null}
      </AnimatePresence>

      {/* Close — pinned to the WINDOW's top-right corner (outside the shrinking
          stage, above the panel via z-50) so it stays in the exact same place
          whether the info panel is open or closed. */}
      <button
        onClick={(e) => { e.stopPropagation(); g.closeViewer(); }}
        className="absolute right-6 top-6 z-50 rounded-full border border-white/20 bg-white/10 p-3 text-white backdrop-blur-md transition-all hover:scale-110 hover:border-white/30 hover:bg-white/20"
        aria-label="Close photo viewer"
        title="Close (Esc)"
      >
        <X className="h-5 w-5" />
      </button>
    </motion.div>
  );
}
