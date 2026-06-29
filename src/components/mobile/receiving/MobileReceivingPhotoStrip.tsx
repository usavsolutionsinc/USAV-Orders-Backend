'use client';

import { memo, useCallback, useMemo, useState } from 'react';
import { useReceivingPhotosRealtimeRefresh } from '@/hooks/useReceivingPhotosRealtimeRefresh';
import { useScopedReceivingPhotos } from '@/hooks/useScopedReceivingPhotos';
import { useAuth } from '@/contexts/AuthContext';
import { SkeletonBase } from '@/design-system/components/Skeletons';
import { MobilePhotoCountBadge } from '@/components/mobile/receiving/MobilePhotoCountBadge';
import {
  MobileSwipePhotoViewer,
  type SwipePhotoSlide,
} from '@/components/mobile/station/MobileSwipePhotoViewer';

interface MobileReceivingPhotoStripProps {
  receivingId: number;
  staffId: number;
  /** Kept for deep-link fallback (+ Photo flows); in-sheet viewing uses the swipe viewer. */
  galleryHref: string;
  countHint?: number;
  onNavigate?: () => void;
}

/**
 * Phone-only photo preview row for the carton sheet: scrollable tall thumbnails
 * (all photos) on the left, camera xN on the right. Tap any thumb or the badge
 * to open {@link MobileSwipePhotoViewer} — same swipe + Dismiss UX as the camera.
 */
export const MobileReceivingPhotoStrip = memo(function MobileReceivingPhotoStrip({
  receivingId,
  staffId,
  countHint = 0,
}: MobileReceivingPhotoStripProps) {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const scope = useMemo(
    () => ({ receivingId, receivingLineId: null as number | null, photosListScope: 'all' as const }),
    [receivingId],
  );

  const { photos, deletePhoto, query } = useScopedReceivingPhotos(scope);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const refreshPhotos = useCallback(() => {
    void query.refetch();
  }, [query]);

  useReceivingPhotosRealtimeRefresh(receivingId, staffId, refreshPhotos, staffId > 0 && !!orgId);

  const photoCount = photos.length > 0 ? photos.length : Math.max(0, countHint);

  const swipeSlides = useMemo<SwipePhotoSlide[]>(
    () =>
      photos.map((p) => ({
        id: String(p.id),
        previewUrl: p.displayUrl,
        deletable: true,
      })),
    [photos],
  );

  const openViewer = useCallback(
    (index: number) => {
      if (photos.length === 0) return;
      setViewerIndex(index);
      setViewerOpen(true);
    },
    [photos.length],
  );

  const handleDelete = useCallback(
    async (slide: SwipePhotoSlide) => {
      const photoId = Number(slide.id);
      if (!Number.isFinite(photoId)) return;
      await deletePhoto(photoId);
    },
    [deletePhoto],
  );

  const { isLoading, error, data } = query;

  if (isLoading && data === undefined) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-gray-50 p-2" aria-hidden>
        <div className="flex min-w-0 flex-1 gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonBase key={i} width="4.5rem" height="96px" className="shrink-0 rounded-lg" />
          ))}
        </div>
        <SkeletonBase width="40px" height="20px" className="rounded-md" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-center text-micro font-bold uppercase tracking-widest text-rose-500">
        Couldn&apos;t load photos
      </p>
    );
  }

  return (
    <>
      <div className="flex items-stretch gap-2 rounded-xl bg-gray-50 p-2 ring-1 ring-inset ring-gray-200">
        <div className="flex min-w-0 flex-1 items-stretch gap-2 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {photos.length === 0 ? (
            <div className="flex h-24 w-full items-center justify-center rounded-lg bg-gray-100/80 text-caption font-semibold text-gray-400">
              No photos yet
            </div>
          ) : (
            photos.map((p, index) => (
              <button
                key={p.id}
                type="button"
                onClick={() => openViewer(index)}
                className="ds-raw-button relative h-24 w-[4.5rem] shrink-0 overflow-hidden rounded-lg bg-gray-200 shadow-sm active:opacity-90"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.displayUrl} alt="" className="h-full w-full object-cover" />
              </button>
            ))
          )}
        </div>
        <div className="flex shrink-0 items-center self-center pr-1">
          <MobilePhotoCountBadge
            count={photoCount}
            size="md"
            onClick={photoCount > 0 ? () => openViewer(Math.max(0, photos.length - 1)) : undefined}
          />
        </div>
      </div>

      <MobileSwipePhotoViewer
        presentation="sheet"
        open={viewerOpen}
        initialIndex={viewerIndex}
        slides={swipeSlides}
        onClose={() => setViewerOpen(false)}
        onDelete={handleDelete}
      />
    </>
  );
});
