'use client';

import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { Image as ImageIcon } from '../Icons';
import { usePhotoGallery, type PhotoGalleryProps } from './photo-gallery/usePhotoGallery';
import { PhotoLauncher } from './photo-gallery/PhotoLauncher';
import { PhotoViewerModal } from './photo-gallery/PhotoViewerModal';

export type { PhotoGalleryInput } from './photo-gallery/photo-gallery-utils';

/**
 * Photo gallery: a launcher surface (thumbnail strip / slim toolbar / button)
 * plus a portaled fullscreen viewer with zoom, download-all, copy-links, and
 * a two-step delete. Thin composition layer — state/logic live in
 * {@link usePhotoGallery} under `./photo-gallery/`.
 */
export function PhotoGallery(props: PhotoGalleryProps) {
  const g = usePhotoGallery(props);

  if (g.photoItems.length === 0) {
    return (
      <div className={`w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 ${g.className}`}>
        <div className="flex items-center justify-center gap-2 text-gray-500">
          <ImageIcon className="h-4 w-4" />
          <span className="text-xs font-semibold">No photos available</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <PhotoLauncher g={g} />

      {g.mounted && typeof document !== 'undefined' && createPortal(
        <AnimatePresence mode="wait">
          {g.viewerOpen && <PhotoViewerModal g={g} />}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
