'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import {
  MobileSwipePhotoViewer,
  type SwipePhotoSlide,
} from '@/components/mobile/station/MobileSwipePhotoViewer';
import { useReceivingPhotosRealtimeRefresh } from '@/hooks/useReceivingPhotosRealtimeRefresh';
import { useScopedReceivingPhotos } from '@/hooks/useScopedReceivingPhotos';
import { useAuth } from '@/contexts/AuthContext';
import { notifyReceivingPhotoChanged } from '@/lib/queries/receiving-queries';
import { framerTransitionMobile, motionBezier } from '@/design-system/foundations/motion-framer';
import type { PhotoScope } from '@/components/mobile/receiving/PhotoUploadQueue';

const VIEWER_BG = '#0a0a0b';

function GalleryShell({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="flex min-h-[100dvh] items-center justify-center"
      style={{ backgroundColor: VIEWER_BG }}
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduce ? undefined : { opacity: 0 }}
      transition={framerTransitionMobile.cameraEnter}
    >
      {children}
    </motion.div>
  );
}

/**
 * Full-screen receiving photo gallery — the same {@link MobileSwipePhotoViewer}
 * the capture camera opens from its bottom-left bubble. No grid, NAS toolbar, or
 * zip download; dismiss returns to `returnHref`.
 */
export function MobileReceivingSwipeGallery({
  scope,
  returnHref,
}: {
  scope: PhotoScope;
  returnHref: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const reduce = useReducedMotion();
  const { user } = useAuth();
  const staffId = user?.staffId ?? 0;
  const orgId = user?.organizationId;

  const { photos, deletePhoto, queryKey, query } = useScopedReceivingPhotos({
    ...scope,
    photosListScope: scope.photosListScope ?? (scope.receivingLineId != null ? undefined : 'all'),
  });

  useEffect(() => {
    router.prefetch(returnHref);
  }, [router, returnHref]);

  const refreshPhotos = useCallback(() => {
    void query.refetch();
  }, [query]);

  useReceivingPhotosRealtimeRefresh(
    scope.receivingId,
    staffId,
    refreshPhotos,
    staffId > 0 && !!orgId,
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

  const returnToCaller = useCallback(() => {
    router.replace(returnHref);
  }, [router, returnHref]);

  const redirectToCapture = useCallback(() => {
    if (typeof window === 'undefined') {
      returnToCaller();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('mode');
    router.replace(url.pathname + url.search);
  }, [router, returnToCaller]);

  useEffect(() => {
    if (query.isLoading) return;
    if (photos.length === 0) redirectToCapture();
  }, [photos.length, query.isLoading, redirectToCapture]);

  const handleClose = useCallback(() => {
    returnToCaller();
  }, [returnToCaller]);

  const handleDelete = useCallback(
    async (slide: SwipePhotoSlide) => {
      const photoId = Number(slide.id);
      if (!Number.isFinite(photoId)) return;
      const ok = await deletePhoto(photoId);
      if (!ok) return;
      notifyReceivingPhotoChanged(queryClient, {
        action: 'delete',
        receivingId: scope.receivingId,
        photoIds: [photoId],
      });
      void queryClient.invalidateQueries({ queryKey });
    },
    [deletePhoto, queryClient, queryKey, scope.receivingId],
  );

  if (query.isLoading) {
    return (
      <GalleryShell>
        <div className="flex flex-col items-center gap-4" aria-busy aria-label="Loading photos">
          <motion.div
            className="h-1 w-20 overflow-hidden rounded-full bg-white/10"
            initial={reduce ? false : { opacity: 0, scaleX: 0.6 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={framerTransitionMobile.cameraEnter}
          >
            <motion.div
              className="h-full w-1/2 rounded-full bg-white/50"
              animate={reduce ? {} : { x: ['-100%', '200%'] }}
              transition={
                reduce
                  ? { duration: 0 }
                  : { duration: 1.1, repeat: Infinity, ease: motionBezier.easeOut }
              }
            />
          </motion.div>
        </div>
      </GalleryShell>
    );
  }

  if (query.error) {
    return (
      <GalleryShell>
        <p className="max-w-xs px-6 text-center text-sm font-bold text-white/70">
          Couldn&apos;t load photos.
        </p>
      </GalleryShell>
    );
  }

  if (photos.length === 0) {
    return <div className="min-h-[100dvh]" style={{ backgroundColor: VIEWER_BG }} />;
  }

  return (
    <MobileSwipePhotoViewer
      presentation="sheet"
      open
      initialIndex={Math.max(0, photos.length - 1)}
      slides={swipeSlides}
      onClose={handleClose}
      onDelete={handleDelete}
    />
  );
}
