import { AnimatePresence, motion } from 'framer-motion';
import { framerTransition } from '@/design-system/foundations/motion-framer';
import { zIndex as zLayer } from '@/design-system/tokens/z-index';
import {
  X, Download, ZoomIn, ZoomOut, ChevronLeft, ChevronRight,
  AlertCircle, Check, Trash2, Link2 as LinkIcon, Plus, Info, RotateCcw,
} from '../../Icons';
import { PhotoContextPanel } from './PhotoContextPanel';
import type { PhotoGalleryController } from './usePhotoGallery';

/** Fullscreen lightbox: zoomable image, nav arrows, thumbnail strip, toolbar. */
export function PhotoViewerModal({ g }: { g: PhotoGalleryController }) {
  const { photoItems, currentIndex, zoomLevel } = g;
  // Info panel rides alongside the stage as a flex sibling (not an overlay) so
  // the stage shrinks and the centered controls/arrows recenter automatically.
  const panelVisible = g.hasContext && g.panelOpen;

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
      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 p-6 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent z-10">
        <div className="flex items-center gap-3">
          <div className="px-4 py-2 bg-white/10 backdrop-blur-md rounded-full border border-white/20">
            <span className="text-white text-sm font-black">
              {currentIndex + 1} / {photoItems.length}
            </span>
          </div>
          {zoomLevel > 1 && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="px-3 py-2 bg-blue-500/20 backdrop-blur-md rounded-full border border-blue-400/30"
            >
              <span className="text-blue-200 text-xs font-black">{Math.round(zoomLevel * 100)}%</span>
            </motion.div>
          )}
        </div>

        <div className="flex items-center gap-2">
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

          {g.canDeleteCurrent && (
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

          {g.hasContext && (
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

          <button
            onClick={(e) => { e.stopPropagation(); g.closeViewer(); }}
            className="p-3 bg-white/10 hover:bg-white/20 rounded-full transition-all text-white backdrop-blur-md border border-white/20 hover:border-white/30 hover:scale-110"
            aria-label="Close photo viewer"
            title="Close (Esc)"
          >
            <X className="h-5 w-5" />
          </button>
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

      {/* Zoom Controls */}
      <div
        className={`absolute left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/50 backdrop-blur-md rounded-full p-2 border border-white/20 z-10 ${
          photoItems.length > 1 ? 'bottom-32' : 'bottom-8'
        }`}
      >
        <button
          onClick={(e) => { e.stopPropagation(); g.zoomOut(); }}
          disabled={zoomLevel <= 1}
          className="p-2 hover:bg-white/10 rounded-full transition-all text-white disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Zoom out"
          title="Zoom out (-)"
        >
          <ZoomOut className="h-5 w-5" />
        </button>
        <div className="px-3 py-1 min-w-[60px] text-center">
          <span className="text-white text-sm font-bold">{Math.round(zoomLevel * 100)}%</span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); g.zoomIn(); }}
          disabled={zoomLevel >= 3}
          className="p-2 hover:bg-white/10 rounded-full transition-all text-white disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Zoom in"
          title="Zoom in (+)"
        >
          <ZoomIn className="h-5 w-5" />
        </button>
        <div className="mx-1 h-5 w-px bg-white/20" aria-hidden="true" />
        <button
          onClick={(e) => { e.stopPropagation(); g.rotateCw(); }}
          className="p-2 hover:bg-white/10 rounded-full transition-all text-white"
          aria-label="Rotate 90 degrees"
          title="Rotate (r)"
        >
          <RotateCcw className="h-5 w-5" />
        </button>
        {(zoomLevel > 1 || g.rotation !== 0) && (
          <button
            onClick={(e) => { e.stopPropagation(); g.resetZoom(); }}
            className="ml-1 px-3 py-1 bg-white/10 hover:bg-white/20 rounded-full transition-all text-white text-xs font-bold"
            aria-label="Reset view"
            title="Reset (0)"
          >
            Reset
          </button>
        )}
      </div>

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
      </div>
      {/* Info panel — flex sibling of the stage; mount/unmount animated. */}
      <AnimatePresence initial={false}>
        {panelVisible ? <PhotoContextPanel photo={photoItems[currentIndex]} /> : null}
      </AnimatePresence>
    </motion.div>
  );
}
