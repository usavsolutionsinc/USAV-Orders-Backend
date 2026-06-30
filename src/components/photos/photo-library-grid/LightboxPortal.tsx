'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { usePhotoGallery } from '@/components/shipped/photo-gallery/usePhotoGallery';
import { PhotoViewerModal } from '@/components/shipped/photo-gallery/PhotoViewerModal';
import type { PhotoGalleryInput } from '@/components/shipped/photo-gallery/photo-gallery-utils';

/**
 * Mounts the shared fullscreen viewer for a set of photos, opens it at
 * `startIndex` on mount, and calls `onClose` (to unmount) once the viewer is
 * dismissed. Shared by the folders view and the flat (list/grid) views.
 */
export function LightboxPortal({
  photos,
  startIndex = 0,
  onClose,
  onPhotoDeleted,
}: {
  photos: PhotoGalleryInput[];
  startIndex?: number;
  onClose: () => void;
  onPhotoDeleted?: (photoId: number) => void;
}) {
  // {id,url,meta} (not bare urls) so the viewer's delete + info panel show.
  const gallery = usePhotoGallery({ photos, onPhotoDeleted });
  const { openViewer, viewerOpen } = gallery;
  const openedRef = useRef(false);

  // Open exactly once. `openViewer`'s identity changes every render (its deps
  // include the per-render useImageZoom object), so an unguarded effect would
  // re-open the viewer immediately after the user closes it.
  const requestedRef = useRef(false);
  useEffect(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    openViewer(startIndex);
  }, [openViewer, startIndex]);

  useEffect(() => {
    if (viewerOpen) openedRef.current = true;
    else if (openedRef.current) onClose();
  }, [viewerOpen, onClose]);

  if (!gallery.mounted || typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence mode="wait">
      {viewerOpen ? <PhotoViewerModal g={gallery} /> : null}
    </AnimatePresence>,
    document.body,
  );
}
