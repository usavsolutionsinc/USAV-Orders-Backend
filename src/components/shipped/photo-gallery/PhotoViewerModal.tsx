import { useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { framerTransition } from '@/design-system/foundations/motion-framer';
import { useMotionTransition } from '@/design-system/foundations/motion-framer-hooks';
import { zIndex as zLayer } from '@/design-system/tokens/z-index';
import {
  X, Download, ZoomIn, ZoomOut, ChevronLeft, ChevronRight,
  AlertCircle, Trash2, Info, RotateCcw, RefreshCw, ExternalLink, Package,
} from '../../Icons';
import { PhotoContextPanel } from './PhotoContextPanel';
import { MovePhotoToPoPanel } from './MovePhotoToPoPanel';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import { photoHeroLayoutId } from './photo-gallery-utils';
import type { PhotoGalleryController } from './usePhotoGallery';

/** Fullscreen lightbox: zoomable image, nav arrows, thumbnail strip, toolbar. */
export function PhotoViewerModal({ g }: { g: PhotoGalleryController }) {
  const { photoItems, currentIndex, zoomLevel } = g;
  // Reset is always shown (fixed-width icon button) so the toolbar never reflows:
  // grayed + disabled at the default view, filled once zoom/rotation is applied.
  const canReset = zoomLevel > 1 || g.rotation !== 0;
  const panelVisible = g.panelOpen;
  const reduceMotion = useReducedMotion();
  const heroTransition = useMotionTransition(framerTransition.photoHeroMorph);

  // The grid-tile → lightbox hero morph (shared `layoutId`) only ever plays for
  // the photo the viewer opened on. Once the user navigates away it is "spent"
  // even if they arrow back to this same photo — a matching in-viewer nav
  // shouldn't re-trigger a travel-from-the-grid animation (motion-crossfade.md:
  // don't animate keyboard-driven nav).
  const heroIndexRef = useRef(currentIndex);
  const heroSpentRef = useRef(false);
  useEffect(() => {
    if (currentIndex !== heroIndexRef.current) heroSpentRef.current = true;
  }, [currentIndex]);
  const isHeroFrame = !reduceMotion && !heroSpentRef.current && currentIndex === heroIndexRef.current;
  const heroLayoutId = isHeroFrame ? photoHeroLayoutId(photoItems[currentIndex]?.id) : undefined;

  return (
    <motion.div
      data-testid="photo-lightbox"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 flex bg-scrim/95 backdrop-blur-md"
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
          <div className="px-4 py-2 bg-glass/10 backdrop-blur-md rounded-full border border-glass/20">
            <span className="text-white text-sm font-black">
              {currentIndex + 1} / {photoItems.length}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-full border border-glass/20 bg-glass/10 p-1 backdrop-blur-md">
            <HoverTooltip label="Zoom out (-)" asChild>
              <IconButton
                onClick={(e) => { e.stopPropagation(); g.zoomOut(); }}
                disabled={zoomLevel <= 1}
                className="rounded-full p-2 text-white transition-all hover:bg-glass/10 disabled:cursor-not-allowed disabled:opacity-30"
                ariaLabel="Zoom out"
                icon={<ZoomOut className="h-4 w-4 text-white" />}
              />
            </HoverTooltip>
            <span className="min-w-[44px] text-center text-xs font-bold tabular-nums text-white">
              {Math.round(zoomLevel * 100)}%
            </span>
            <HoverTooltip label="Zoom in (+)" asChild>
              <IconButton
                onClick={(e) => { e.stopPropagation(); g.zoomIn(); }}
                disabled={zoomLevel >= 3}
                className="rounded-full p-2 text-white transition-all hover:bg-glass/10 disabled:cursor-not-allowed disabled:opacity-30"
                ariaLabel="Zoom in"
                icon={<ZoomIn className="h-4 w-4 text-white" />}
              />
            </HoverTooltip>
            <div className="mx-0.5 h-5 w-px bg-glass/20" aria-hidden="true" />
            <HoverTooltip label="Rotate (r)" asChild>
              <IconButton
                onClick={(e) => { e.stopPropagation(); g.rotateCw(); }}
                className="rounded-full p-2 text-white transition-all hover:bg-glass/10"
                ariaLabel="Rotate 90 degrees"
                icon={<RotateCcw className="h-4 w-4 text-white" />}
              />
            </HoverTooltip>
            <HoverTooltip label="Reset (0)" asChild>
              <IconButton
                onClick={(e) => { e.stopPropagation(); g.resetZoom(); }}
                disabled={!canReset}
                className={`ml-0.5 rounded-full p-2 transition-all ${
                  canReset ? 'bg-glass/20 text-white hover:bg-glass/30' : 'text-white/30'
                }`}
                ariaLabel="Reset view"
                icon={<RefreshCw className="h-4 w-4" />}
              />
            </HoverTooltip>
          </div>

          <div className="mx-1 h-6 w-px bg-glass/20" aria-hidden="true" />

          <HoverTooltip
            label={g.downloading ? 'Downloading…' : `Download photo ${currentIndex + 1}`}
            asChild
          >
            <IconButton
              onClick={(e) => { e.stopPropagation(); void g.handleDownloadCurrent(); }}
              disabled={g.downloading || photoItems[currentIndex]?.status === 'error'}
              className="p-3 bg-glass/10 hover:bg-glass/20 rounded-full transition-all text-white backdrop-blur-md border border-glass/20 hover:border-glass/30 hover:scale-110 disabled:opacity-50 disabled:hover:scale-100"
              ariaLabel={`Download photo ${currentIndex + 1}`}
              icon={<Download className="h-5 w-5 text-white" />}
            />
          </HoverTooltip>

          {g.libraryHref ? (
            <HoverTooltip label="Open in media library" asChild>
              <a
                href={g.libraryHref}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="p-3 rounded-full transition-all text-white backdrop-blur-md border bg-glass/10 hover:bg-glass/20 border-glass/20 hover:border-glass/30 hover:scale-110"
                aria-label="Open in media library"
              >
                <ExternalLink className="h-5 w-5 text-white" />
              </a>
            </HoverTooltip>
          ) : null}

          <HoverTooltip label="Toggle details (i)" asChild>
            <IconButton
              onClick={(e) => { e.stopPropagation(); g.togglePanel(); }}
              aria-pressed={g.panelOpen}
              className={
                g.panelOpen
                  ? 'p-3 rounded-full transition-all text-white backdrop-blur-md border bg-blue-500/30 border-blue-300/40 hover:bg-blue-500/40 hover:scale-110'
                  : 'p-3 rounded-full transition-all text-white backdrop-blur-md border bg-glass/10 hover:bg-glass/20 border-glass/20 hover:border-glass/30 hover:scale-110'
              }
              ariaLabel={g.panelOpen ? 'Hide photo details' : 'Show photo details'}
              icon={<Info className="h-5 w-5 text-white" />}
            />
          </HoverTooltip>

          {g.canReassignCurrent && (
            <HoverTooltip label="Move to another PO" asChild>
              <IconButton
                onClick={(e) => { e.stopPropagation(); g.setReassignOpen(true); }}
                disabled={g.reassigning}
                className="p-3 rounded-full transition-all text-white backdrop-blur-md border bg-glass/10 hover:bg-glass/20 border-glass/20 hover:border-glass/30 hover:scale-110 disabled:opacity-50"
                ariaLabel="Move photo to another PO"
                icon={<Package className="h-5 w-5 text-white" />}
              />
            </HoverTooltip>
          )}

          {g.canDeleteCurrent && (
            <HoverTooltip label={g.deleteArmed ? 'Click again to confirm' : 'Delete photo'} asChild>
              {/* ds-raw-button: morphs icon-only ↔ icon+label ("Confirm"/"Deleting…") on arm; neither Button nor IconButton models that conditional label swap */}
              <button
                onClick={(e) => { e.stopPropagation(); g.handleDeleteClick(); }}
                disabled={g.deletingPhoto}
                className={
                  g.deleteArmed
                    ? 'flex items-center gap-2 px-4 py-3 rounded-full transition-all text-white backdrop-blur-md border bg-red-500/80 border-red-300 hover:bg-red-500 disabled:opacity-60'
                    : 'p-3 rounded-full transition-all text-white backdrop-blur-md border bg-glass/10 hover:bg-red-500/30 border-glass/20 hover:border-red-300 hover:scale-110 disabled:opacity-60'
                }
                aria-label={g.deleteArmed ? 'Confirm delete photo' : 'Delete photo'}
              >
                <Trash2 className="h-5 w-5" />
                {g.deleteArmed && (
                  <span className="text-xs font-bold uppercase tracking-wider">
                    {g.deletingPhoto ? 'Deleting…' : 'Confirm'}
                  </span>
                )}
              </button>
            </HoverTooltip>
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

      {g.reassignError && !g.reassignOpen && (
        <div
          className="absolute top-24 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-full bg-amber-600/90 border border-amber-300 text-white text-xs font-bold backdrop-blur-md shadow-lg"
          role="alert"
        >
          {g.reassignError}
        </div>
      )}

      <MovePhotoToPoPanel
        open={g.reassignOpen}
        currentReceivingId={g.receivingId}
        busy={g.reassigning}
        error={g.reassignError}
        onClose={() => g.setReassignOpen(false)}
        onSelect={(targetReceivingId) => void g.handleReassignToReceiving(targetReceivingId)}
      />

      {/* Main Photo */}
      <motion.div
        key={currentIndex}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={framerTransition.dropdownOpen}
        className="relative w-full h-full flex items-center justify-center p-4 sm:pl-16 sm:pr-16 sm:py-16"
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
            layoutId={heroLayoutId}
            transition={heroLayoutId ? heroTransition : undefined}
            className="max-h-[78vh] max-w-[90vw] object-contain rounded-2xl shadow-2xl select-none sm:max-h-[65vh] sm:max-w-[48vw]"
            style={{ scale: zoomLevel, rotate: g.rotation, x: g.imagePosition.x, y: g.imagePosition.y }}
            draggable={false}
          />
        ) : photoItems[currentIndex]?.status === 'error' ? (
          <div className="w-full max-w-2xl h-96 flex flex-col items-center justify-center bg-red-900/20 rounded-2xl border-2 border-red-500/30">
            <AlertCircle className="h-16 w-16 text-red-400 mb-4" />
            <p className="text-red-300 text-lg font-bold">Failed to load image</p>
          </div>
        ) : photoItems[currentIndex]?.thumbUrl ? (
          // Instant low-res placeholder while the full image preloads — never a
          // black/spinner-only stage on a slow (mobile) connection. Shares the
          // hero layoutId so the grid→lightbox morph starts immediately off this
          // (already-cached) thumbnail rather than waiting on the full-res fetch.
          <motion.img
            src={photoItems[currentIndex].thumbUrl}
            alt={`Photo ${currentIndex + 1}`}
            layoutId={heroLayoutId}
            transition={heroLayoutId ? heroTransition : undefined}
            className="max-h-[78vh] max-w-[90vw] object-contain rounded-2xl shadow-2xl select-none blur-[1px] sm:max-h-[65vh] sm:max-w-[48vw]"
            draggable={false}
          />
        ) : (
          <div className="w-full max-w-2xl h-96 flex items-center justify-center bg-stage-raised/50 rounded-2xl">
            <div className="h-12 w-12 border-4 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
          </div>
        )}
      </motion.div>

      {/* Navigation Arrows */}
      {photoItems.length > 1 && (
        <>
          <HoverTooltip label="Previous (←)" asChild>
            <IconButton
              onClick={(e) => { e.stopPropagation(); g.handlePrevious(); }}
              className="absolute left-8 top-1/2 -translate-y-1/2 p-4 bg-glass/10 hover:bg-glass/20 rounded-full transition-all text-white backdrop-blur-md border border-glass/20 hover:border-glass/30 hover:scale-110 z-10"
              ariaLabel="Previous photo"
              icon={<ChevronLeft className="h-6 w-6 text-white" />}
            />
          </HoverTooltip>
          <HoverTooltip label="Next (→)" asChild>
            <IconButton
              onClick={(e) => { e.stopPropagation(); g.handleNext(); }}
              className="absolute right-8 top-1/2 -translate-y-1/2 p-4 bg-glass/10 hover:bg-glass/20 rounded-full transition-all text-white backdrop-blur-md border border-glass/20 hover:border-glass/30 hover:scale-110 z-10"
              ariaLabel="Next photo"
              icon={<ChevronRight className="h-6 w-6 text-white" />}
            />
          </HoverTooltip>
        </>
      )}

      {/* Thumbnail Strip — portrait thumbs. The pill itself is `w-fit max-w-full
          mx-auto`, so it shrinks to its thumbs and stays centered when they fit,
          and scrolls internally once they exceed the available width. */}
      {photoItems.length > 1 && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 max-w-4xl w-full px-8 z-10">
          <div className="mx-auto w-fit max-w-full overflow-x-auto no-scrollbar rounded-2xl border border-glass/20 bg-scrim/50 p-3 backdrop-blur-md">
            <div className="flex items-center gap-2">
              {photoItems.map((photo, index) => (
                // ds-raw-button: image thumbnail tile (selectable), not an icon/label button
                <button
                  key={index}
                  onClick={(e) => { e.stopPropagation(); g.setCurrentIndex(index); g.resetZoom(); }}
                  className={`relative flex-shrink-0 h-20 w-14 overflow-hidden rounded-lg transition-all ${
                    index === currentIndex ? 'ring-3 ring-white shadow-xl scale-105' : 'opacity-60 hover:opacity-100 hover:scale-105'
                  }`}
                >
                  {photo.status === 'error' ? (
                    <div className="w-full h-full bg-red-900/50 flex items-center justify-center">
                      <AlertCircle className="h-6 w-6 text-red-400" />
                    </div>
                  ) : (
                    <img src={photo.thumbUrl ?? photo.url} alt={`Thumbnail ${index + 1}`} loading="lazy" className="w-full h-full bg-stage-raised object-cover" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      </div>
      {/* Info panel — flex sibling of the stage; mount/unmount animated. */}
      <AnimatePresence initial={false}>
        {panelVisible ? <PhotoContextPanel photo={photoItems[currentIndex]} /> : null}
      </AnimatePresence>

      {/* Close — pinned to the WINDOW's top-right corner (outside the shrinking
          stage, above the panel via z-50) so it stays in the exact same place
          whether the info panel is open or closed. */}
      <HoverTooltip label="Close (Esc)" asChild>
        <IconButton
          onClick={(e) => { e.stopPropagation(); g.closeViewer(); }}
          className="absolute right-6 top-6 z-50 rounded-full border border-glass/20 bg-glass/10 p-3 text-white backdrop-blur-md transition-all hover:scale-110 hover:border-glass/30 hover:bg-glass/20"
          ariaLabel="Close photo viewer"
          icon={<X className="h-5 w-5 text-white" />}
        />
      </HoverTooltip>
    </motion.div>
  );
}
