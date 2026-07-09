'use client';

import { useCallback, useEffect, useState } from 'react';
import { useBodyScrollLock } from '@/design-system/hooks';
import { dispatchReceivingPhotoChanged } from '@/utils/events';
import {
  downloadPhotoBlob,
  downloadPhotoById,
  downloadPhotoZip,
  deletePhoto,
} from './photo-gallery-api';
import { usePhotoItems } from './usePhotoItems';
import { useImageZoom } from './useImageZoom';
import { uploadPhotoClient } from '@/lib/photos/upload-client';
import type { PhotoEntityType } from '@/lib/photos/types';
import type { PhotoGalleryInput, PhotoItem } from './photo-gallery-utils';

/**
 * Entity a viewer upload attaches to. Upload always targets the gallery's OWN
 * entity — never an arbitrary one — so a dropped/picked file joins the photos
 * already on screen. Receiving galleries derive this from `receivingId`; other
 * surfaces pass it explicitly.
 */
export interface PhotoUploadTarget {
  entityType: PhotoEntityType;
  entityId: number;
  photoType?: string;
  poRef?: string;
}

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
  /** Show "Move to PO" in the viewer when the user can reassign receiving photos. */
  allowReassign?: boolean;
  /** Called after a photo is moved to another PO (parents invalidate cache). */
  onPhotoReassigned?: (photoId: number) => void;
  /**
   * Enables the viewer's "Upload photos" action (⋮ menu item + drag-and-drop
   * onto the lightbox). Uploaded files attach to THIS entity — the gallery's own
   * entity. Omit and the affordance is hidden. Receiving galleries (those given
   * a `receivingId`) derive this automatically, so no call-site change is needed.
   */
  uploadTarget?: PhotoUploadTarget;
  /** Called after each successful upload (parents invalidate cache). */
  onPhotoUploaded?: (photoId: number) => void;
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
    allowReassign = false,
    onPhotoReassigned,
    uploadTarget,
    onPhotoUploaded,
  } = props;

  const { photoItems, setPhotoItems, resetFingerprint, loadedCount, errorCount } = usePhotoItems(photos);
  const zoom = useImageZoom();

  const [viewerOpen, setViewerOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deletingPhoto, setDeletingPhoto] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useBodyScrollLock(viewerOpen);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % photoItems.length);
    zoom.resetZoom();
    setDeleteArmed(false);
    setDeleteError(null);
    setReassignError(null);
    setUploadError(null);
  }, [photoItems.length, zoom]);

  const handlePrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + photoItems.length) % photoItems.length);
    zoom.resetZoom();
    setDeleteArmed(false);
    setDeleteError(null);
    setReassignError(null);
    setUploadError(null);
  }, [photoItems.length, zoom]);

  const closeViewer = useCallback(() => {
    setViewerOpen(false);
    zoom.resetZoom();
    setDeleteArmed(false);
    setDeleteError(null);
    setReassignOpen(false);
    setReassignError(null);
    setUploadError(null);
  }, [zoom]);

  const openViewer = useCallback((index: number) => {
    setCurrentIndex(index);
    setViewerOpen(true);
    zoom.resetZoom();
    setDeleteArmed(false);
    setDeleteError(null);
    setReassignOpen(false);
    setReassignError(null);
    setUploadError(null);
  }, [zoom]);

  useEffect(() => {
    if (!viewerOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Keep global chords (⌘K search, etc.) from stealing focus while the
      // lightbox is up — the trap can't recover if focus lands in the header.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Modified shortcuts are for the browser / OS — viewer only owns bare keys.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          closeViewer();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handlePrevious();
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleNext();
          break;
        case '+':
        case '=':
          e.preventDefault();
          zoom.zoomIn();
          break;
        case '-':
          e.preventDefault();
          zoom.zoomOut();
          break;
        case '0':
          e.preventDefault();
          zoom.resetZoom();
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          zoom.rotateCw();
          break;
        case 'i':
        case 'I':
          e.preventDefault();
          setPanelOpen((prev) => !prev);
          break;
      }
    };
    // Capture so we win over page-level listeners (library grid, command bar).
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [viewerOpen, closeViewer, handlePrevious, handleNext, zoom]);

  const downloadFilename = (index: number, photoId: number | null) => {
    if (orderId && photoId != null) return `${orderId}_photo_${photoId}.jpg`;
    if (orderId) return `${orderId}_photo_${index + 1}.jpg`;
    if (photoId != null) return `photo-${photoId}.jpg`;
    return `photo-${index + 1}.jpg`;
  };

  const downloadPhotoAtIndex = async (index: number) => {
    const photo = photoItems[index];
    if (!photo?.url) return;
    const filename = downloadFilename(index, photo.id);
    if (typeof photo.id === 'number' && Number.isFinite(photo.id)) {
      await downloadPhotoById(photo.id, filename);
      return;
    }
    await downloadPhotoBlob(photo.url, filename);
  };

  const handleDownloadCurrent = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadPhotoAtIndex(currentIndex);
    } catch (error) {
      console.error('Failed to download image:', error);
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadAll = async () => {
    if (downloading || photoItems.length === 0) return;
    setDownloading(true);
    try {
      const ids = photoItems
        .map((p) => p.id)
        .filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0);

      if (ids.length >= 2) {
        downloadPhotoZip(ids, orderId ?? undefined);
        return;
      }
      if (ids.length === 1) {
        const idx = photoItems.findIndex((p) => p.id === ids[0]);
        await downloadPhotoAtIndex(idx >= 0 ? idx : 0);
        return;
      }

      for (let i = 0; i < photoItems.length; i++) {
        await downloadPhotoAtIndex(i);
        await new Promise((r) => setTimeout(r, 280));
      }
    } catch (error) {
      console.error('Failed to download images:', error);
    } finally {
      setDownloading(false);
    }
  };

  const currentPhoto = photoItems[currentIndex];
  const canDeleteCurrent = typeof currentPhoto?.id === 'number' && Number.isFinite(currentPhoto.id);
  const canReassignCurrent =
    allowReassign &&
    canDeleteCurrent &&
    (currentPhoto?.meta?.sourceScope === 'unboxing' ||
      (currentPhoto?.meta?.photoType ?? '').toUpperCase().includes('RECEIV'));

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

  // Upload always attaches to the gallery's own entity. Prefer an explicit
  // target; otherwise derive it from a receiving-scoped gallery so receiving
  // surfaces get upload for free without a new call-site prop — never an
  // arbitrary/unowned entity.
  const effectiveUploadTarget: PhotoUploadTarget | null =
    uploadTarget ??
    (typeof receivingId === 'number' && Number.isFinite(receivingId) && receivingId > 0
      ? { entityType: 'RECEIVING', entityId: receivingId, photoType: 'receiving_item', poRef: orderId }
      : null);
  const canUpload = effectiveUploadTarget !== null;

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      if (!effectiveUploadTarget || uploading) return;
      const images = files.filter((f) => f.type.startsWith('image/'));
      if (images.length === 0) return;
      // Inherit the sibling photos' source context so the new upload files under
      // the same badge/PO in the info panel.
      const inheritedMeta = photoItems[currentIndex]?.meta;
      const firstNewIndex = photoItems.length;
      setUploading(true);
      setUploadError(null);
      try {
        const uploadedIds: number[] = [];
        const newItems: PhotoItem[] = [];
        for (const file of images) {
          const res = await uploadPhotoClient({
            file,
            entityType: effectiveUploadTarget.entityType,
            entityId: effectiveUploadTarget.entityId,
            photoType: effectiveUploadTarget.photoType,
            poRef: effectiveUploadTarget.poRef,
          });
          uploadedIds.push(res.id);
          newItems.push({
            id: res.id,
            url: res.url,
            thumbUrl: res.thumbUrl,
            status: 'loading',
            index: 0, // reindexed on append below
            meta: inheritedMeta,
          });
        }
        if (uploadedIds.length === 0) return;
        // Append optimistically; resetFingerprint so a later parent refetch
        // reconciles instead of duplicating (mirrors the delete path).
        resetFingerprint();
        setPhotoItems((prev) => [
          ...prev,
          ...newItems.map((item, i) => ({ ...item, index: prev.length + i })),
        ]);
        setCurrentIndex(firstNewIndex);
        zoom.resetZoom();
        dispatchReceivingPhotoChanged({
          action: 'upload',
          photoIds: uploadedIds,
          receivingId: receivingId ?? null,
        });
        uploadedIds.forEach((id) => onPhotoUploaded?.(id));
      } catch (err) {
        console.error('Failed to upload photo(s):', err);
        setUploadError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setUploading(false);
      }
    },
    [effectiveUploadTarget, uploading, photoItems, currentIndex, resetFingerprint, setPhotoItems, receivingId, onPhotoUploaded, zoom],
  );

  const handleReassignToReceiving = async (targetReceivingId: number) => {
    const photo = photoItems[currentIndex];
    const photoId = photo?.id;
    if (typeof photoId !== 'number' || !Number.isFinite(photoId)) return;
    if (receivingId != null && targetReceivingId === receivingId) {
      setReassignError('Photo is already on this PO');
      return;
    }
    setReassigning(true);
    setReassignError(null);
    try {
      const { reassignPhotoToReceiving } = await import('./photo-gallery-api');
      await reassignPhotoToReceiving(photoId, targetReceivingId);
      const remaining = photoItems.filter((_, i) => i !== currentIndex);
      resetFingerprint();
      setPhotoItems(remaining);
      setReassignOpen(false);
      dispatchReceivingPhotoChanged({
        action: 'delete',
        photoIds: [photoId],
        receivingId: receivingId ?? null,
      });
      onPhotoReassigned?.(photoId);
      if (remaining.length === 0) {
        closeViewer();
      } else {
        setCurrentIndex((prev) => Math.min(prev, remaining.length - 1));
        zoom.resetZoom();
      }
    } catch (err) {
      setReassignError(err instanceof Error ? err.message : 'Move failed');
    } finally {
      setReassigning(false);
    }
  };

  return {
    className, compact, launcherTitle, launcherLayout, toolbarShowLabel, libraryHref,
    allowReassign, receivingId,
    photoItems, loadedCount, errorCount,
    viewerOpen, currentIndex, mounted, openViewer, closeViewer, handleNext, handlePrevious, setCurrentIndex,
    panelOpen, togglePanel: () => setPanelOpen((prev) => !prev),
    ...zoom,
    downloading, handleDownloadCurrent, handleDownloadAll,
    canDeleteCurrent, deleteArmed, deletingPhoto, deleteError, handleDeleteClick,
    deletePhotoDirect: performDelete,
    canReassignCurrent, reassignOpen, setReassignOpen, reassigning, reassignError,
    handleReassignToReceiving,
    canUpload, uploading, uploadError, handleUploadFiles,
    clearUploadError: () => setUploadError(null),
  };
}

export type PhotoGalleryController = ReturnType<typeof usePhotoGallery>;
