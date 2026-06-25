'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  MobilePackerSpamCamera,
  type CapturedShot,
} from '@/components/mobile/station/MobilePackerSpamCamera';
import {
  packerPhotoUploadQueue,
  useClearPackerDoneOnUnmount,
  type PackerPhotoScope,
} from '@/components/mobile/packer/PackerPhotoUploadQueue';
import { useScopedPackerPhotos } from '@/hooks/useScopedPackerPhotos';

export interface MobilePackerPhotoStudioProps {
  packerLogId: number;
  orderId: string;
  headerLabel: string;
  returnHref: string;
  maxPhotos?: number;
}

/** Immersive pack photo capture — mirror of receiving studio (capture-only). */
export function MobilePackerPhotoStudio({
  packerLogId,
  orderId,
  headerLabel,
  returnHref,
  maxPhotos = 10,
}: MobilePackerPhotoStudioProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  useClearPackerDoneOnUnmount();

  const scope = useMemo<PackerPhotoScope>(
    () => ({ packerLogId, orderId }),
    [packerLogId, orderId],
  );

  const { priorPhotos, deletePrior, queryKey, query } = useScopedPackerPhotos(packerLogId);

  const returnToPack = useCallback(() => {
    router.replace(returnHref);
  }, [router, returnHref]);

  useEffect(() => {
    packerPhotoUploadQueue.configureNotifier((notice) => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['packer-photos', notice.packerLogId] });
      queryClient.invalidateQueries({ queryKey: ['packer-logs-mobile'] });
    });
  }, [queryClient, queryKey]);

  const handleDeletePrior = useCallback(
    async (photoId: number) => {
      await deletePrior(photoId);
    },
    [deletePrior],
  );

  const handleDone = useCallback(
    (shots: CapturedShot[]) => {
      if (shots.length === 0) {
        returnToPack();
        return;
      }
      const existingCount = query.data?.photos?.length ?? 0;
      shots.forEach((s, index) => {
        packerPhotoUploadQueue.enqueue(
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
      returnToPack();
    },
    [query.data?.photos?.length, returnToPack, scope],
  );

  return (
    <MobilePackerSpamCamera
      embedded
      onDone={handleDone}
      onCancel={returnToPack}
      maxPhotos={maxPhotos}
      priorPhotos={priorPhotos}
      onDeletePrior={handleDeletePrior}
      header={
        <div className="min-w-0">
          <p className="text-micro font-black uppercase tracking-[0.22em] text-white/60">
            Add pack photos
          </p>
          <p className="truncate text-sm font-black text-white">{headerLabel}</p>
        </div>
      }
    />
  );
}
