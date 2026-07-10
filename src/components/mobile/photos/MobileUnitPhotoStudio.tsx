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
  unitPhotoUploadQueue,
  useClearDoneUnitUploadsOnUnmount,
} from '@/components/mobile/unit/UnitPhotoUploadQueue';
import { useScopedUnitPhotos, unitPhotosQueryKey } from '@/hooks/useScopedUnitPhotos';
import { useAblyClient } from '@/contexts/AblyContext';
import { useAuth } from '@/contexts/AuthContext';
import { safeChannelName, getPhoneBridgeChannelName } from '@/lib/realtime/channels';

export interface MobileUnitPhotoStudioProps {
  serialUnitId: number;
  /** Resolvable unit key (serial / minted unit_uid) — files the object path. */
  unitKey?: string | null;
  headerLabel: string;
  returnHref: string;
  maxPhotos?: number;
  /** Drives the per-photo `unit_photo_uploaded` echo back to the desktop. */
  requestId?: string | null;
}

/**
 * Phone capture surface for SERIAL_UNIT testing-scan photos — the unit-scoped
 * mirror of `MobileReceivingPhotoStudio`. Captures via the shared
 * MobilePackerSpamCamera, enqueues into `unitPhotoUploadQueue` (GCS-primary,
 * entityType SERIAL_UNIT, photoType `testing_photo`), and echoes
 * `unit_photo_uploaded` on `phone:{staffId}` so the desktop refreshes.
 * See docs/todo/packer-testing-photo-scan-timeline-plan.md.
 */
export function MobileUnitPhotoStudio({
  serialUnitId,
  unitKey = null,
  headerLabel,
  returnHref,
  maxPhotos = 10,
  requestId = null,
}: MobileUnitPhotoStudioProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  useClearDoneUnitUploadsOnUnmount();

  const { getClient } = useAblyClient();
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const notifyStaffId = user?.staffId ?? 0;
  const phoneChannelName = safeChannelName(() => getPhoneBridgeChannelName(orgId!, notifyStaffId));

  const { priorPhotos, deletePhoto, query } = useScopedUnitPhotos(serialUnitId);

  const returnToCaller = useCallback(() => {
    router.replace(returnHref);
  }, [router, returnHref]);

  useEffect(() => {
    if (notifyStaffId <= 0 || !phoneChannelName) return;
    unitPhotoUploadQueue.configureNotifier(async (notice) => {
      try {
        // Local: refresh this device's unit photo strip immediately.
        void queryClient.invalidateQueries({ queryKey: unitPhotosQueryKey(notice.serialUnitId) });
        // Cross-device: nudge the paired desktop.
        const client = await getClient();
        if (!client) return;
        const ch = client.channels.get(phoneChannelName);
        await ch.publish('unit_photo_uploaded', {
          serial_unit_id: notice.serialUnitId,
          photo_id: notice.photoId,
          photo_url: notice.photoUrl,
          ...(requestId ? { request_id: requestId } : {}),
        });
      } catch (err) {
        console.warn('unit photo queue: unit_photo_uploaded publish failed', err);
      }
    });
  }, [getClient, notifyStaffId, phoneChannelName, queryClient, requestId]);

  const handleDeletePrior = useCallback(
    async (photoId: number) => {
      await deletePhoto(photoId);
    },
    [deletePhoto],
  );

  const handleDone = useCallback(
    (shots: CapturedShot[]) => {
      if (shots.length === 0) {
        returnToCaller();
        return;
      }
      const existingCount = query.data?.photos?.length ?? 0;
      shots.forEach((s, index) => {
        unitPhotoUploadQueue.enqueue(
          { serialUnitId, unitKey, fileIndex: existingCount + index + 1 },
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
    [query.data?.photos?.length, returnToCaller, serialUnitId, unitKey],
  );

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
            Add testing photos
          </p>
          <p className="truncate text-sm font-black text-white">{headerLabel}</p>
        </div>
      }
    />
  );
}
