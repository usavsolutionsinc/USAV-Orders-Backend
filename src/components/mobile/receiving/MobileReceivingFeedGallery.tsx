'use client';

import { useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  MobileSwipePhotoViewer,
  type SwipePhotoSlide,
} from '@/components/mobile/station/MobileSwipePhotoViewer';
import { useReceivingPhotosRealtimeRefresh } from '@/hooks/useReceivingPhotosRealtimeRefresh';
import { useScopedReceivingPhotos } from '@/hooks/useScopedReceivingPhotos';
import { useAuth } from '@/contexts/AuthContext';
import { notifyReceivingPhotoChanged } from '@/lib/queries/receiving-queries';
import { zIndex as zLayer } from '@/design-system/tokens/z-index';

/**
 * Fullscreen swipe gallery mounted on the receiving feed — stays on `/m/receiving`
 * (no navigation to `/m/r/{id}/photos`).
 */
export function MobileReceivingFeedGallery({
  receivingId,
  staffId,
  open,
  onClose,
}: {
  receivingId: number | null;
  staffId: number;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId;

  const scope = useMemo(
    () =>
      receivingId
        ? {
            receivingId,
            receivingLineId: null as number | null,
            photosListScope: 'all' as const,
          }
        : {
            receivingId: 0,
            receivingLineId: null as number | null,
            photosListScope: 'all' as const,
          },
    [receivingId],
  );

  const { photos, deletePhoto, queryKey, query } = useScopedReceivingPhotos(scope, {
    enabled: open && receivingId != null && receivingId > 0,
  });

  const refreshPhotos = useCallback(() => {
    void query.refetch();
  }, [query]);

  useReceivingPhotosRealtimeRefresh(
    receivingId ?? 0,
    staffId,
    refreshPhotos,
    open && staffId > 0 && !!orgId && receivingId != null && receivingId > 0,
  );

  const swipeSlides = useMemo<SwipePhotoSlide[]>(
    () =>
      photos.map((p) => ({
        id: String(p.id),
        previewUrl: p.displayUrl,
        deletable: true,
      })),
    [photos],
  );

  const handleDelete = useCallback(
    async (slide: SwipePhotoSlide) => {
      if (!receivingId) return;
      const photoId = Number(slide.id);
      if (!Number.isFinite(photoId)) return;
      const ok = await deletePhoto(photoId);
      if (!ok) return;
      notifyReceivingPhotoChanged(queryClient, {
        action: 'delete',
        receivingId,
        photoIds: [photoId],
      });
      void queryClient.invalidateQueries({ queryKey });
    },
    [deletePhoto, queryClient, queryKey, receivingId],
  );

  if (!open || !receivingId) return null;

  if (query.isLoading && swipeSlides.length === 0) {
    return createPortal(
      <div
        className="fixed inset-0 flex items-center justify-center bg-[#0a0a0b]"
        style={{ zIndex: zLayer.modal + 1 }}
        aria-busy
        aria-label="Loading photos"
      >
        <div className="h-1 w-20 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-white/50" />
        </div>
      </div>,
      document.body,
    );
  }

  if (!query.isLoading && swipeSlides.length === 0) {
    return createPortal(
      <div
        className="fixed inset-0 flex items-center justify-center bg-[#0a0a0b] px-6"
        style={{ zIndex: zLayer.modal + 1 }}
      >
        <p className="text-center text-sm font-bold text-white/70">No photos yet.</p>
        <button
          type="button"
          onClick={onClose}
          className="absolute inset-0"
          aria-label="Dismiss"
        />
      </div>,
      document.body,
    );
  }

  return (
    <MobileSwipePhotoViewer
      presentation="sheet"
      open
      initialIndex={Math.max(0, swipeSlides.length - 1)}
      slides={swipeSlides}
      onClose={onClose}
      onDelete={handleDelete}
    />
  );
}
