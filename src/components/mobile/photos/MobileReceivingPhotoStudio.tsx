'use client';

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  MobilePackerSpamCamera,
  type CapturedShot,
} from '@/components/mobile/station/MobilePackerSpamCamera';
import {
  photoUploadQueue,
  useClearDoneOnUnmount,
  type PhotoScope,
} from '@/components/mobile/receiving/PhotoUploadQueue';
import { useNasConfig } from '@/hooks/useNasConfig';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import { useScopedReceivingPhotos } from '@/hooks/useScopedReceivingPhotos';
import { useAblyClient } from '@/contexts/AblyContext';
import { useAuth } from '@/contexts/AuthContext';
import { safeChannelName, getPhoneBridgeChannelName } from '@/lib/realtime/channels';
import { notifyReceivingPhotoChanged } from '@/lib/queries/receiving-queries';
import { MobileReceivingSwipeGallery } from '@/components/mobile/photos/MobileReceivingSwipeGallery';

export type MobilePhotoStudioMode = 'capture' | 'gallery';

export interface MobileReceivingPhotoStudioProps {
  mode: MobilePhotoStudioMode;
  scope: PhotoScope;
  headerLabel: string;
  /** @deprecated Gallery is swipe-only; kept for route compat. */
  galleryTitle?: string;
  /** @deprecated Gallery is swipe-only; kept for route compat. */
  gallerySubtitle?: string;
  backHref: string;
  returnHref: string;
  maxPhotos?: number;
  requestId?: string | null;
}

/**
 * Unified receiving photo station: capture (camera) or gallery (swipe viewer).
 */
export function MobileReceivingPhotoStudio({
  mode,
  scope,
  headerLabel,
  backHref,
  returnHref,
  maxPhotos = 12,
  requestId = null,
}: MobileReceivingPhotoStudioProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  useClearDoneOnUnmount();
  useNasConfig();
  useRealtimeInvalidation({ receiving: true });

  const { getClient } = useAblyClient();
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const notifyStaffId = user?.staffId ?? 0;
  const phoneChannelName = safeChannelName(() => getPhoneBridgeChannelName(orgId!, notifyStaffId));

  const { priorPhotos, deletePhoto, query } = useScopedReceivingPhotos({
    ...scope,
    photosListScope: scope.photosListScope ?? (scope.receivingLineId != null ? undefined : 'all'),
  });

  const returnToCaller = useCallback(() => {
    router.replace(returnHref);
  }, [router, returnHref]);

  useEffect(() => {
    if (notifyStaffId <= 0 || !phoneChannelName) return;
    photoUploadQueue.configureNotifier(async (notice) => {
      try {
        notifyReceivingPhotoChanged(queryClient, {
          action: 'insert',
          receivingId: notice.receivingId,
          photoIds: [notice.photoId],
        });
        const client = await getClient();
        if (!client) return;
        const ch = client.channels.get(phoneChannelName);
        await ch.publish('receiving_photo_uploaded', {
          receiving_id: notice.receivingId,
          receiving_line_id: notice.receivingLineId,
          photo_id: notice.photoId,
          photo_url: notice.photoUrl,
          ...(requestId ? { request_id: requestId } : {}),
        });
      } catch (err) {
        console.warn('photo queue: receiving_photo_uploaded publish failed', err);
      }
    });
  }, [getClient, notifyStaffId, phoneChannelName, queryClient, requestId]);

  const handleDeletePrior = useCallback(
    async (photoId: number) => {
      const ok = await deletePhoto(photoId);
      if (!ok) return;
      notifyReceivingPhotoChanged(queryClient, {
        action: 'delete',
        receivingId: scope.receivingId,
        photoIds: [photoId],
      });
    },
    [deletePhoto, queryClient, scope.receivingId],
  );

  const handleDone = useCallback(
    (shots: CapturedShot[]) => {
      if (shots.length === 0) {
        returnToCaller();
        return;
      }
      const existingCount = query.data?.photos?.length ?? 0;
      shots.forEach((s, index) => {
        photoUploadQueue.enqueue(
          { ...scope, fileIndex: existingCount + index + 1 },
          s.blob,
          s.previewUrl,
        );
      });
      toast.message(`Uploading ${shots.length} photo${shots.length === 1 ? '' : 's'}…`, {
        description: 'Saving to storage in the background.',
        position: 'top-center',
        duration: 5000,
      });
      returnToCaller();
    },
    [query.data?.photos?.length, returnToCaller, scope],
  );

  if (mode === 'gallery') {
    return <MobileReceivingSwipeGallery scope={scope} returnHref={backHref || returnHref} />;
  }

  return (
    <MobilePackerSpamCamera
      embedded
      onDone={handleDone}
      onCancel={returnToCaller}
      maxPhotos={maxPhotos}
      priorPhotos={priorPhotos}
      onDeletePrior={handleDeletePrior}
      header={
        <div className="min-w-0">
          <p className="text-micro font-black uppercase tracking-[0.22em] text-white/60">
            Add unboxing photos
          </p>
          <p className="truncate text-sm font-black text-white">{headerLabel}</p>
        </div>
      }
    />
  );
}
