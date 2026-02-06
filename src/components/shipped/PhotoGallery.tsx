'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Image as ImageIcon, AlertCircle } from '../Icons';

interface PhotoGalleryProps {
  photos: Array<string | { url: string; index: number; uploadedAt: string }>;
  orderId?: string;
  className?: string;
  compact?: boolean;
}

interface PhotoItem {
  url: string;
  status: 'loading' | 'loaded' | 'error';
  index: number;
}

export function PhotoGallery({ photos, orderId, className = '', compact = false }: PhotoGalleryProps) {
  const [photoItems, setPhotoItems] = useState<PhotoItem[]>([]);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    
    // Cleanup on unmount
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // Parse and initialize photo items
  useEffect(() => {
    const urls = photos.map((photo) => 
      typeof photo === 'string' ? photo : photo.url
    ).filter(url => url && url.trim());

    setPhotoItems(
      urls.map((url, index) => ({
        url,
        status: 'loading',
        index,
      }))
    );
  }, [photos]);

  // Preload images
  useEffect(() => {
    photoItems.forEach((photo, index) => {
      if (photo.status === 'loading') {
        const img = new Image();
        img.onload = () => {
          setPhotoItems((prev) =>
            prev.map((item, i) =>
              i === index ? { ...item, status: 'loaded' } : item
            )
          );
        };
        img.onerror = () => {
          setPhotoItems((prev) =>
            prev.map((item, i) =>
              i === index ? { ...item, status: 'error' } : item
            )
          );
        };
        img.src = photo.url;
      }
    });
  }, [photoItems]);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % photoItems.length);
    resetZoom();
  }, [photoItems.length]);

  const handlePrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + photoItems.length) % photoItems.length);
    resetZoom();
  }, [photoItems.length]);

  const closeViewer = useCallback(() => {
    setViewerOpen(false);
    resetZoom();
    document.body.style.overflow = '';
  }, []);

  const openViewer = useCallback((index: number) => {
    setCurrentIndex(index);
    setViewerOpen(true);
    resetZoom();
    document.body.style.overflow = 'hidden';
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!viewerOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          closeViewer();
          break;
        case 'ArrowLeft':
          handlePrevious();
          break;
        case 'ArrowRight':
          handleNext();
          break;
        case '+':
        case '=':
          handleZoomIn();
          break;
        case '-':
          handleZoomOut();
          break;
        case '0':
          resetZoom();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewerOpen, currentIndex, zoomLevel, closeViewer, handlePrevious, handleNext]);

  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(prev + 0.5, 3));
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.max(prev - 0.5, 1));
  };

  const resetZoom = () => {
    setZoomLevel(1);
    setImagePosition({ x: 0, y: 0 });
  };

  const handleDownload = async () => {
    const currentPhoto = photoItems[currentIndex];
    if (!currentPhoto) return;

    try {
      const response = await fetch(currentPhoto.url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Use order_id in filename if available
      const filename = orderId 
        ? `${orderId}_photo_${currentIndex + 1}.jpg`
        : `photo-${currentIndex + 1}.jpg`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download image:', error);
    }
  };

  // Mouse drag handlers for zoomed images
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoomLevel > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - imagePosition.x, y: e.clientY - imagePosition.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && zoomLevel > 1) {
      setImagePosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  if (photoItems.length === 0) {
    return (
      <div className={`w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 ${className}`}>
        <div className="flex items-center justify-center gap-2 text-gray-400">
          <ImageIcon className="w-4 h-4" />
          <span className="text-xs font-semibold">No photos available</span>
        </div>
      </div>
    );
  }

  const loadedCount = photoItems.filter((p) => p.status === 'loaded').length;
  const errorCount = photoItems.filter((p) => p.status === 'error').length;

  // Photo viewer modal component
  const renderPhotoViewerModal = () => {
    if (!viewerOpen || !mounted) return null;
    
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/95 backdrop-blur-md flex items-center justify-center"
        style={{ zIndex: 99999 }}
      >
      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 p-6 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent z-10">
        <div className="flex items-center gap-3">
          {/* Photo Counter */}
          <div className="px-4 py-2 bg-white/10 backdrop-blur-md rounded-full border border-white/20">
            <span className="text-white text-sm font-black">
              {currentIndex + 1} / {photoItems.length}
            </span>
          </div>
          
          {/* Zoom Level */}
          {zoomLevel > 1 && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="px-3 py-2 bg-blue-500/20 backdrop-blur-md rounded-full border border-blue-400/30"
            >
              <span className="text-blue-200 text-xs font-black">
                {Math.round(zoomLevel * 100)}%
              </span>
            </motion.div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Download Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDownload();
            }}
            className="p-3 bg-white/10 hover:bg-white/20 rounded-full transition-all text-white backdrop-blur-md border border-white/20 hover:border-white/30 hover:scale-110"
            aria-label="Download photo"
            title="Download photo"
          >
            <Download className="w-5 h-5" />
          </button>

          {/* Close Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              closeViewer();
            }}
            className="p-3 bg-white/10 hover:bg-white/20 rounded-full transition-all text-white backdrop-blur-md border border-white/20 hover:border-white/30 hover:scale-110"
            aria-label="Close photo viewer"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Photo */}
      <motion.div
        key={currentIndex}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="relative w-full h-full flex items-center justify-center pl-16 pr-16 py-16"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: zoomLevel > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
      >
        {photoItems[currentIndex]?.status === 'loaded' ? (
          <motion.img
            src={photoItems[currentIndex].url}
            alt={`Photo ${currentIndex + 1}`}
            className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl select-none"
            style={{
              scale: zoomLevel,
              x: imagePosition.x,
              y: imagePosition.y,
              maxHeight: '65vh',
              maxWidth: '40vw',
            }}
            drag={zoomLevel > 1}
            dragElastic={0.1}
            dragMomentum={false}
          />
        ) : photoItems[currentIndex]?.status === 'error' ? (
          <div className="w-full max-w-2xl h-96 flex flex-col items-center justify-center bg-red-900/20 rounded-2xl border-2 border-red-500/30">
            <AlertCircle className="w-16 h-16 text-red-400 mb-4" />
            <p className="text-red-300 text-lg font-bold">Failed to load image</p>
          </div>
        ) : (
          <div className="w-full max-w-2xl h-96 flex items-center justify-center bg-gray-800/50 rounded-2xl">
            <div className="w-12 h-12 border-4 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
          </div>
        )}
      </motion.div>

      {/* Zoom Controls */}
      <div className="absolute bottom-36 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/50 backdrop-blur-md rounded-full p-2 border border-white/20 z-10">
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleZoomOut();
          }}
          disabled={zoomLevel <= 1}
          className="p-2 hover:bg-white/10 rounded-full transition-all text-white disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Zoom out"
          title="Zoom out (-)"
        >
          <ZoomOut className="w-5 h-5" />
        </button>
        
        <div className="px-3 py-1 min-w-[60px] text-center">
          <span className="text-white text-sm font-bold">{Math.round(zoomLevel * 100)}%</span>
        </div>
        
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleZoomIn();
          }}
          disabled={zoomLevel >= 3}
          className="p-2 hover:bg-white/10 rounded-full transition-all text-white disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Zoom in"
          title="Zoom in (+)"
        >
          <ZoomIn className="w-5 h-5" />
        </button>

        {zoomLevel > 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              resetZoom();
            }}
            className="ml-2 px-3 py-1 bg-white/10 hover:bg-white/20 rounded-full transition-all text-white text-xs font-bold"
            aria-label="Reset zoom"
            title="Reset zoom (0)"
          >
            Reset
          </button>
        )}
      </div>

      {/* Navigation Arrows */}
      {photoItems.length > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handlePrevious();
            }}
            className="absolute left-8 top-1/2 -translate-y-1/2 p-4 bg-white/10 hover:bg-white/20 rounded-full transition-all text-white backdrop-blur-md border border-white/20 hover:border-white/30 hover:scale-110 z-10"
            aria-label="Previous photo"
            title="Previous (←)"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            className="absolute right-8 top-1/2 -translate-y-1/2 p-4 bg-white/10 hover:bg-white/20 rounded-full transition-all text-white backdrop-blur-md border border-white/20 hover:border-white/30 hover:scale-110 z-10"
            aria-label="Next photo"
            title="Next (→)"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </>
      )}

      {/* Thumbnail Strip */}
      {photoItems.length > 1 && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 max-w-4xl w-full px-8 z-10">
          <div className="flex items-center gap-2 bg-black/50 backdrop-blur-md rounded-2xl p-3 border border-white/20 overflow-x-auto no-scrollbar">
            {photoItems.map((photo, index) => (
              <button
                key={index}
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentIndex(index);
                  resetZoom();
                }}
                className={`relative flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden transition-all ${
                  index === currentIndex
                    ? 'ring-3 ring-white shadow-xl scale-110'
                    : 'opacity-60 hover:opacity-100 hover:scale-105'
                }`}
              >
                {photo.status === 'loaded' ? (
                  <img
                    src={photo.url}
                    alt={`Thumbnail ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                ) : photo.status === 'error' ? (
                  <div className="w-full h-full bg-red-900/50 flex items-center justify-center">
                    <AlertCircle className="w-6 h-6 text-red-400" />
                  </div>
                ) : (
                  <div className="w-full h-full bg-gray-700 animate-pulse" />
                )}
                <div className="absolute inset-0 border border-white/20 rounded-xl pointer-events-none" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Hint */}
      <div className="absolute bottom-8 right-8 bg-black/30 backdrop-blur-md rounded-xl p-3 border border-white/10 text-white/60 text-xs space-y-1 z-10">
        <div className="flex items-center gap-2">
          <kbd className="px-2 py-0.5 bg-white/10 rounded">←→</kbd>
          <span>Navigate</span>
        </div>
        <div className="flex items-center gap-2">
          <kbd className="px-2 py-0.5 bg-white/10 rounded">±</kbd>
          <span>Zoom</span>
        </div>
        <div className="flex items-center gap-2">
          <kbd className="px-2 py-0.5 bg-white/10 rounded">Esc</kbd>
          <span>Close</span>
        </div>
      </div>
    </motion.div>
    );
  };

  return (
    <>
      {/* Compact View All Button */}
      <button
        onClick={() => openViewer(0)}
        className={`w-full bg-gradient-to-r from-blue-50 to-blue-100/50 hover:from-blue-100 hover:to-blue-100 border border-blue-200 hover:border-blue-300 rounded-xl px-4 py-3 transition-all active:scale-[0.98] group ${className}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center shadow-sm">
              <ImageIcon className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col items-start">
              <span className="text-sm font-bold text-gray-900">
                View Packing Photos
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] font-black text-blue-600 uppercase tracking-wider">
                  {photoItems.length} {photoItems.length === 1 ? 'Photo' : 'Photos'}
                </span>
                {loadedCount < photoItems.length && errorCount === 0 && (
                  <span className="text-[10px] font-semibold text-amber-600">
                    • Loading...
                  </span>
                )}
                {errorCount > 0 && (
                  <span className="text-[10px] font-semibold text-red-600">
                    • {errorCount} Failed
                  </span>
                )}
              </div>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-blue-600 group-hover:translate-x-1 transition-transform" />
        </div>
      </button>

      {/* Render modal using Portal */}
      {mounted && typeof document !== 'undefined' && createPortal(
        <AnimatePresence mode="wait">
          {viewerOpen && renderPhotoViewerModal()}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
