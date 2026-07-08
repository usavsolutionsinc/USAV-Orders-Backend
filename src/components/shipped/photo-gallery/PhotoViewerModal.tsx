import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { framerTransition } from '@/design-system/foundations/motion-framer';
import { useMotionTransition } from '@/design-system/foundations/motion-framer-hooks';
import { useFocusTrap } from '@/design-system/hooks';
import { zIndex as zLayer } from '@/design-system/tokens/z-index';
import {
  X, Download, ZoomIn, ZoomOut, ChevronLeft, ChevronRight,
  AlertCircle, Trash2, Info, RotateCcw, RefreshCw, ExternalLink, Package, MoreVertical,
  Upload, Loader2,
} from '../../Icons';
import { PhotoContextPanel } from './PhotoContextPanel';
import { MovePhotoToPoPanel } from './MovePhotoToPoPanel';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import { usePhotoDropzone } from '@/hooks/usePhotoDropzone';
import { photoHeroLayoutId } from './photo-gallery-utils';
import type { PhotoGalleryController } from './usePhotoGallery';

const TOOLBAR_ICON_BTN =
  'rounded-full border border-glass/20 bg-glass/10 p-3 text-white backdrop-blur-md transition-all hover:scale-110 hover:border-glass/30 hover:bg-glass/20 disabled:opacity-50 disabled:hover:scale-100';

/** Fullscreen lightbox: zoomable image, nav arrows, thumbnail strip, toolbar. */
export function PhotoViewerModal({ g }: { g: PhotoGalleryController }) {
  const { photoItems, currentIndex, zoomLevel } = g;
  // Reset is always shown (fixed-width icon button) so the toolbar never reflows:
  // grayed + disabled at the default view, filled once zoom/rotation is applied.
  const canReset = zoomLevel > 1 || g.rotation !== 0;
  const panelVisible = g.panelOpen;
  const reduceMotion = useReducedMotion();
  const heroTransition = useMotionTransition(framerTransition.photoHeroMorph);
  // Keep Tab inside the lightbox — without this the page behind the scrim
  // keeps receiving keyboard focus.
  const trapRef = useFocusTrap<HTMLDivElement>(true);

  const moreRef = useRef<HTMLDivElement>(null);
  const downloadRef = useRef<HTMLDivElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);

  // Drag-and-drop / click-to-browse uploader — armed only when the gallery has an
  // upload target. Files attach to the gallery's own entity (see usePhotoGallery).
  const dz = usePhotoDropzone(g.handleUploadFiles);

  const multiPhoto = photoItems.length > 1;
  const currentPhotoError = photoItems[currentIndex]?.status === 'error';
  const allPhotosError = photoItems.every((p) => p.status === 'error');
  const canDownloadCurrent = !g.downloading && !currentPhotoError;
  const canDownloadAll = !g.downloading && !allPhotosError && photoItems.length > 0;

  // Close overflow menus when the photo changes; keep the viewer open.
  useEffect(() => {
    setMoreOpen(false);
    setDownloadOpen(false);
  }, [currentIndex]);

  useEffect(() => {
    if (!moreOpen && !downloadOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (moreRef.current?.contains(target) || downloadRef.current?.contains(target)) return;
      setMoreOpen(false);
      setDownloadOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [moreOpen, downloadOpen]);

  // Escape closes toolbar menus first; only the second Esc reaches usePhotoGallery.
  useEffect(() => {
    if (!moreOpen && !downloadOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setMoreOpen(false);
      setDownloadOpen(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [moreOpen, downloadOpen]);

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
      ref={trapRef}
      data-testid="photo-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      tabIndex={-1}
      initial={{ opacity: 0, pointerEvents: 'auto' }}
      animate={{ opacity: 1, pointerEvents: 'auto' }}
      exit={{ opacity: 0, pointerEvents: 'none' }}
      className="fixed inset-0 flex bg-scrim/95 outline-none backdrop-blur-md"
      style={{ zIndex: zLayer.modal }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      {...(g.canUpload ? dz.rootProps : {})}
    >
      {/* Hidden file input backing the ⋮ "Upload photos" item + drag-and-drop. */}
      {g.canUpload ? <input ref={dz.inputRef} {...dz.inputProps} /> : null}

      {/* Drop overlay — covers the whole lightbox while files are dragged over it. */}
      <AnimatePresence>
        {g.canUpload && dz.isDragging ? (
          <motion.div
            key="drop-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="pointer-events-none absolute inset-3 z-40 flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-white/70 bg-scrim/70 backdrop-blur-md"
          >
            <Upload className="h-10 w-10 text-white" />
            <p className="text-sm font-black uppercase tracking-widest text-white">Drop to upload</p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Stage — image lane. flex-1 yields width to the details panel; toolbar
          is scoped here so it never bleeds over the panel border. */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Top bar — counter (left) + zoom/rotate pill + action buttons (right).
          Pinned to the image lane, not the full viewport, so controls stay left
          of the details column when it opens. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between py-6 pl-6 pr-6"
      >
        <div className="pointer-events-auto flex shrink-0 items-center gap-3">
          <div className="rounded-full border border-glass/20 bg-glass/10 px-4 py-2 backdrop-blur-md">
            <span className="text-sm font-black text-white">
              {currentIndex + 1} / {photoItems.length}
            </span>
          </div>
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          {/* Zoom / rotate / reset — inline with the action buttons so the whole
              cluster reads as one toolbar; hidden on phones (the mobile viewer
              owns touch surfaces). p-1.5 matches the p-3 icon buttons' height. */}
          <div className="hidden items-center gap-1 rounded-full border border-glass/20 bg-glass/10 p-1.5 backdrop-blur-md sm:flex">
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

          {/* More actions → Download → Delete → Close (fixed order). Details,
              upload, and other secondary actions live inside the ⋮ menu so the
              inline toolbar is an identical, minimal row on every page. */}
          <div ref={moreRef} className="relative">
            <HoverTooltip label="More actions" asChild>
              <IconButton
                onClick={(e) => {
                  e.stopPropagation();
                  setDownloadOpen(false);
                  setMoreOpen((open) => !open);
                }}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                className={`${TOOLBAR_ICON_BTN} ${moreOpen ? 'border-glass/40 bg-glass/25' : ''}`}
                ariaLabel="More photo actions"
                icon={<MoreVertical className="h-5 w-5 text-white" />}
              />
            </HoverTooltip>

            <AnimatePresence initial={false}>
              {moreOpen ? (
                <motion.div
                  role="menu"
                  aria-label="Photo actions"
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.12 }}
                  className="absolute right-0 top-full z-50 mt-2 min-w-[12rem] overflow-hidden rounded-xl border border-glass/20 bg-scrim/90 py-1 shadow-xl backdrop-blur-xl"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {g.canUpload ? (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={g.uploading}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMoreOpen(false);
                        dz.openPicker();
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm font-semibold text-white transition-colors hover:bg-glass/15 disabled:opacity-50"
                    >
                      {g.uploading ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4 shrink-0" />
                      )}
                      {g.uploading ? 'Uploading…' : 'Upload photos'}
                    </button>
                  ) : null}

                  <button
                    type="button"
                    role="menuitem"
                    aria-pressed={g.panelOpen}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMoreOpen(false);
                      g.togglePanel();
                    }}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-glass/15 ${
                      g.panelOpen ? 'text-blue-200' : 'text-white'
                    }`}
                  >
                    <Info className="h-4 w-4 shrink-0" />
                    {g.panelOpen ? 'Hide details' : 'Show details'}
                  </button>

                  {g.libraryHref ? (
                    <a
                      href={g.libraryHref}
                      target="_blank"
                      rel="noreferrer"
                      role="menuitem"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMoreOpen(false);
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm font-semibold text-white transition-colors hover:bg-glass/15"
                    >
                      <ExternalLink className="h-4 w-4 shrink-0" />
                      Open in library
                    </a>
                  ) : null}

                  {g.canReassignCurrent ? (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={g.reassigning}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMoreOpen(false);
                        g.setReassignOpen(true);
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm font-semibold text-white transition-colors hover:bg-glass/15 disabled:opacity-50"
                    >
                      <Package className="h-4 w-4 shrink-0" />
                      Move to another PO
                    </button>
                  ) : null}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          {/* Download — one photo downloads immediately; multi-photo opens a picker. */}
          <div ref={downloadRef} className="relative">
            <HoverTooltip
              label={
                g.downloading
                  ? 'Downloading…'
                  : multiPhoto
                    ? 'Download photos'
                    : `Download photo ${currentIndex + 1}`
              }
              asChild
            >
              <IconButton
                onClick={(e) => {
                  e.stopPropagation();
                  if (multiPhoto) {
                    setMoreOpen(false);
                    setDownloadOpen((open) => !open);
                    return;
                  }
                  if (canDownloadCurrent) void g.handleDownloadCurrent();
                }}
                disabled={!canDownloadCurrent && !multiPhoto}
                aria-haspopup={multiPhoto ? 'menu' : undefined}
                aria-expanded={multiPhoto ? downloadOpen : undefined}
                className={`${TOOLBAR_ICON_BTN} ${downloadOpen ? 'border-glass/40 bg-glass/25' : ''}`}
                ariaLabel={multiPhoto ? 'Download photos' : `Download photo ${currentIndex + 1}`}
                icon={<Download className="h-5 w-5 text-white" />}
              />
            </HoverTooltip>

            <AnimatePresence initial={false}>
              {downloadOpen && multiPhoto ? (
                <motion.div
                  role="menu"
                  aria-label="Download photos"
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.12 }}
                  className="absolute right-0 top-full z-50 mt-2 min-w-[12rem] overflow-hidden rounded-xl border border-glass/20 bg-scrim/90 py-1 shadow-xl backdrop-blur-xl"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!canDownloadCurrent}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDownloadOpen(false);
                      void g.handleDownloadCurrent();
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm font-semibold text-white transition-colors hover:bg-glass/15 disabled:opacity-50"
                  >
                    <Download className="h-4 w-4 shrink-0" />
                    This photo ({currentIndex + 1}/{photoItems.length})
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!canDownloadAll}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDownloadOpen(false);
                      void g.handleDownloadAll();
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm font-semibold text-white transition-colors hover:bg-glass/15 disabled:opacity-50"
                  >
                    <Download className="h-4 w-4 shrink-0" />
                    All photos ({photoItems.length})
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          {g.canDeleteCurrent && (
            <HoverTooltip label={g.deleteArmed ? 'Click again to confirm' : 'Delete photo'} asChild>
              {/* ds-raw-button: morphs icon-only ↔ icon+label ("Confirm"/"Deleting…") on arm; neither Button nor IconButton models that conditional label swap */}
              <button
                onClick={(e) => { e.stopPropagation(); g.handleDeleteClick(); }}
                disabled={g.deletingPhoto}
                className={
                  g.deleteArmed
                    ? 'flex items-center gap-2 rounded-full border border-red-300 bg-red-500/80 px-4 py-3 text-white backdrop-blur-md transition-all hover:bg-red-500 disabled:opacity-60'
                    : `${TOOLBAR_ICON_BTN} hover:border-red-300 hover:bg-red-500/30 disabled:opacity-60`
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

          <HoverTooltip label="Close (Esc)" asChild>
            <IconButton
              onClick={(e) => { e.stopPropagation(); g.closeViewer(); }}
              className={TOOLBAR_ICON_BTN}
              ariaLabel="Close photo viewer"
              icon={<X className="h-5 w-5 text-white" />}
            />
          </HoverTooltip>
        </div>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
      {g.deleteError && (
        <div
          className="absolute top-24 left-1/2 z-20 -translate-x-1/2 rounded-full border border-red-300 bg-red-600/90 px-4 py-2 text-xs font-bold text-white shadow-lg backdrop-blur-md"
          role="alert"
        >
          {g.deleteError}
        </div>
      )}

      {g.reassignError && !g.reassignOpen && (
        <div
          className="absolute top-24 left-1/2 z-20 -translate-x-1/2 rounded-full border border-amber-300 bg-amber-600/90 px-4 py-2 text-xs font-bold text-white shadow-lg backdrop-blur-md"
          role="alert"
        >
          {g.reassignError}
        </div>
      )}

      {g.uploading && (
        <div
          className="absolute top-24 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-glass/20 bg-scrim/80 px-4 py-2 text-xs font-bold text-white shadow-lg backdrop-blur-md"
          role="status"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Uploading…
        </div>
      )}

      {g.uploadError && !g.uploading && (
        <div
          className="absolute top-24 left-1/2 z-20 -translate-x-1/2 rounded-full border border-red-300 bg-red-600/90 px-4 py-2 text-xs font-bold text-white shadow-lg backdrop-blur-md"
          role="alert"
        >
          {g.uploadError}
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
        className="relative flex h-full w-full items-center justify-center p-4 sm:py-16 sm:pl-16 sm:pr-16"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
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
            className="max-h-[78vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl select-none sm:max-h-[65vh] sm:max-w-[48vw]"
            style={{ scale: zoomLevel, rotate: g.rotation, x: g.imagePosition.x, y: g.imagePosition.y }}
            draggable={false}
          />
        ) : photoItems[currentIndex]?.status === 'error' ? (
          <div className="flex h-96 w-full max-w-2xl flex-col items-center justify-center rounded-2xl border-2 border-red-500/30 bg-red-900/20">
            <AlertCircle className="mb-4 h-16 w-16 text-red-400" />
            <p className="text-lg font-bold text-red-300">Failed to load image</p>
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
            className="max-h-[78vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl select-none blur-[1px] sm:max-h-[65vh] sm:max-w-[48vw]"
            draggable={false}
          />
        ) : (
          <div className="flex h-96 w-full max-w-2xl items-center justify-center rounded-2xl bg-stage-raised/50">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-400/30 border-t-blue-400" />
          </div>
        )}
      </motion.div>

      {/* Navigation Arrows */}
      {photoItems.length > 1 && (
        <>
          <HoverTooltip label="Previous (←)" asChild>
            <IconButton
              onClick={(e) => { e.stopPropagation(); g.handlePrevious(); }}
              className="absolute left-8 top-1/2 z-10 -translate-y-1/2 rounded-full border border-glass/20 bg-glass/10 p-4 text-white backdrop-blur-md transition-all hover:scale-110 hover:border-glass/30 hover:bg-glass/20"
              ariaLabel="Previous photo"
              icon={<ChevronLeft className="h-6 w-6 text-white" />}
            />
          </HoverTooltip>
          <HoverTooltip label="Next (→)" asChild>
            <IconButton
              onClick={(e) => { e.stopPropagation(); g.handleNext(); }}
              className="absolute right-8 top-1/2 z-10 -translate-y-1/2 rounded-full border border-glass/20 bg-glass/10 p-4 text-white backdrop-blur-md transition-all hover:scale-110 hover:border-glass/30 hover:bg-glass/20"
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
        <div className="absolute bottom-8 left-1/2 z-10 w-full max-w-4xl -translate-x-1/2 px-8">
          <div className="no-scrollbar mx-auto w-fit max-w-full overflow-x-auto rounded-2xl border border-glass/20 bg-scrim/50 p-3 backdrop-blur-md">
            <div className="flex items-center gap-2">
              {photoItems.map((photo, index) => (
                // ds-raw-button: image thumbnail tile (selectable), not an icon/label button
                <button
                  key={index}
                  onClick={(e) => { e.stopPropagation(); g.setCurrentIndex(index); g.resetZoom(); }}
                  className={`relative h-20 w-14 flex-shrink-0 overflow-hidden rounded-lg transition-all ${
                    index === currentIndex ? 'scale-105 shadow-xl ring-3 ring-white' : 'opacity-60 hover:scale-105 hover:opacity-100'
                  }`}
                >
                  {photo.status === 'error' ? (
                    <div className="flex h-full w-full items-center justify-center bg-red-900/50">
                      <AlertCircle className="h-6 w-6 text-red-400" />
                    </div>
                  ) : (
                    <img src={photo.thumbUrl ?? photo.url} alt={`Thumbnail ${index + 1}`} loading="lazy" className="h-full w-full bg-stage-raised object-cover" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      </div>
      </div>
      {/* Info panel — flex sibling of the stage; mount/unmount animated. */}
      <AnimatePresence initial={false}>
        {panelVisible ? (
          <PhotoContextPanel
            photo={photoItems[currentIndex]}
            onCollapse={g.togglePanel}
          />
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
