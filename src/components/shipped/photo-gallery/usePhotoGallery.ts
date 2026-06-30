'use client';

import { useCallback, useEffect, useState } from 'react';
import { useBodyScrollLock } from '@/design-system/hooks';
import { dispatchReceivingPhotoChanged } from '@/utils/events';
import { downloadPhotoBlob, deletePhoto } from './photo-gallery-api';
import { usePhotoItems } from './usePhotoItems';
import { useImageZoom } from './useImageZoom';
import type { PhotoGalleryInput } from './photo-gallery-utils';

export interface PhotoGalleryProps {
  photos: PhotoGalleryInput[];
  orderId?: string;
  className?: string;
  compact?: boolean;
  /** Main label on the launcher button (default: packing copy). */
  launcherTitle?: string;
  /**
   * `toolbar` — slim row with download-all, optional copy links, fullscreen.
   * `thumbnails` — a clickable thumbnail strip (no launcher); each opens the
   * fullscreen viewer at that photo. `default` — the shipped launcher button.
   */
  launcherLayout?: 'default' | 'toolbar' | 'thumbnails';
  /** Toolbar row label (`N photos`). Off when the parent already shows the count. */
  toolbarShowLabel?: boolean;
  /** Called after a successful DELETE /api/photos/[id] (parents invalidate cache). */
  onPhotoDeleted?: (photoId: number) => void;
  /** When set, delete broadcasts include this id so only that carton's listeners refresh. */
  receivingId?: number;
  /** Opens the ops photo library filtered to this entity/receiving scope. */
  libraryHref?: string;
}

/**
 * Controller for the photo gallery: composes {@link usePhotoItems} (parse +
 * preload) and {@link useImageZoom} (zoom/pan) and owns the fullscreen viewer,
 * download/copy actions, and the two-step delete (NAS file + DB row). Returns one
 * bag consumed by the launcher + viewer-modal views.
 */
export function usePhotoGallery(props: PhotoGalleryProps) {
  const {
    photos,
    orderId,
    className = '',
    compact = false,
    launcherTitle = 'View Packing Photos',
    launcherLayout = 'default',
    toolbarShowLabel = true,
    onPhotoDeleted,
    receivingId,
    libraryHref,
  } = props;

  const { photoItems, setPhotoItems, resetFingerprint, loadedCount, errorCount } = usePhotoItems(photos);
  const zoom = useImageZoom();

  const [viewerOpen, setViewerOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  // Info panel starts collapsed — the "i" toggle reveals it on demand rather
  // than overlaying photo details by default.
  const [panelOpen, setPanelOpen] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deletingPhoto, setDeletingPhoto] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll while the fullscreen viewer is open.
  useBodyScrollLock(viewerOpen);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % photoItems.length);
    zoom.resetZoom();
    setDeleteArmed(false);
    setDeleteError(null);
  }, [photoItems.length, zoom]);

  const handlePrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + photoItems.length) % photoItems.length);
    zoom.resetZoom();
    setDeleteArmed(false);
    setDeleteError(null);
  }, [photoItems.length, zoom]);

  const closeViewer = useCallback(() => {
    setViewerOpen(false);
    zoom.resetZoom();
    setDeleteArmed(false);
    setDeleteError(null);
  }, [zoom]);

  const openViewer = useCallback((index: number) => {
    setCurrentIndex(index);
    setViewerOpen(true);
    zoom.resetZoom();
    setDeleteArmed(false);
    setDeleteError(null);
  }, [zoom]);

  // Keyboard navigation.
  useEffect(() => {
    if (!viewerOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape': closeViewer(); break;
        case 'ArrowLeft': handlePrevious(); break;
        case 'ArrowRight': handleNext(); break;
        case '+':
        case '=': zoom.zoomIn(); break;
        case '-': zoom.zoomOut(); break;
        case '0': zoom.resetZoom(); break;
        case 'r':
        case 'R': zoom.rotateCw(); break;
        case 'i':
        case 'I': setPanelOpen((prev) => !prev); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewerOpen, closeViewer, handlePrevious, handleNext, zoom]);

  const downloadPhotoAtIndex = async (index: number) => {
    const photo = photoItems[index];
    if (!photo?.url) return;
    const filename = orderId ? `${orderId}_photo_${index + 1}.jpg` : `photo-${index + 1}.jpg`;
    try {
      await downloadPhotoBlob(photo.url, filename);
    } catch (error) {
      console.error('Failed to download image:', error);
    }
  };

  const handleDownloadAll = async () => {
    if (downloadingAll || photoItems.length === 0) return;
    setDownloadingAll(true);
    try {
      for (let i = 0; i < photoItems.length; i++) {
        await downloadPhotoAtIndex(i);
        await new Promise((r) => setTimeout(r, 280));
      }
    } finally {
      setDownloadingAll(false);
    }
  };

  const currentPhoto = photoItems[currentIndex];
  const canDeleteCurrent = typeof currentPhoto?.id === 'number' && Number.isFinite(currentPhoto.id);

  const performDelete = async () => {
    const photo = photoItems[currentIndex];
    const photoId = photo?.id;
    if (typeof photoId !== 'number' || !Number.isFinite(photoId)) return;
    setDeletingPhoto(true);
    setDeleteError(null);
    try {
      await deletePhoto(photoId, photo?.url);
      const remaining = photoItems.filter((_, i) => i !== currentIndex);
      resetFingerprint();
      setPhotoItems(remaining);
      setDeleteArmed(false);
      dispatchReceivingPhotoChanged({
        action: 'delete',
        photoIds: [photoId],
        receivingId: receivingId ?? null,
      });
      onPhotoDeleted?.(photoId);
      if (remaining.length === 0) {
        closeViewer();
      } else {
        setCurrentIndex((prev) => Math.min(prev, remaining.length - 1));
        zoom.resetZoom();
      }
    } catch (err) {
      console.error('Failed to delete photo:', err);
      setDeleteError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingPhoto(false);
    }
  };

  const handleDeleteClick = () => {
    if (!canDeleteCurrent || deletingPhoto) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      window.setTimeout(() => {
        setDeleteArmed((armed) => (armed ? false : armed));
      }, 4000);
      return;
    }
    void performDelete();
  };

  // The info panel is meaningful only when callers attach `meta`; otherwise the
  // toggle/panel stay hidden (legacy thumbnail strips render unchanged).
  const hasContext = photoItems.some((p) => p.meta != null);

  return {
    // static props
    className, compact, launcherTitle, launcherLayout, toolbarShowLabel, libraryHref,
    // items
    photoItems, loadedCount, errorCount,
    // viewer
    viewerOpen, currentIndex, mounted, openViewer, closeViewer, handleNext, handlePrevious, setCurrentIndex,
    // context panel
    hasContext, panelOpen, togglePanel: () => setPanelOpen((prev) => !prev),
    // zoom
    ...zoom,
    // actions
    downloadingAll, handleDownloadAll,
    canDeleteCurrent, deleteArmed, deletingPhoto, deleteError, handleDeleteClick,
    deletePhotoDirect: performDelete,
  };
}

export type PhotoGalleryController = ReturnType<typeof usePhotoGallery>;
