'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  MobilePackerSpamCamera,
  type CapturedShot,
  type PriorPhoto,
} from '@/components/mobile/station/MobilePackerSpamCamera';
import {
  packerPhotoUploadQueue,
  useClearPackerDoneOnUnmount,
  type PackerPhotoScope,
} from '@/components/mobile/packer/PackerPhotoUploadQueue';

interface PackerPhotoCaptureSurfaceProps {
  /** packer_logs.id — every photo binds to a pack log. */
  packerLogId: number;
  /** Human order number — filed as poRef so the library groups by order. */
  orderId: string;
  /** Subtitle line for the camera header (e.g. "Order 11234"). */
  headerLabel: string;
  /** Where to send the packer after they tap Done. */
  returnHref: string;
  /** Hard cap on a single capture batch. Defaults to 10. */
  maxPhotos?: number;
}

/**
 * Shared packer photo capture surface — the packing mirror of receiving's
 * {@link PhotoCaptureSurface}.
 *
 * On the green check-mark, shots enqueue into {@link PackerPhotoUploadQueue}
 * (downscale → POST /api/photos/upload as PACKER_LOG → GCS) and the packer
 * returns immediately while uploads finish in the background. Each committed
 * upload triggers a server-side `packer-photo.changed` Ably publish (station
 * channel) so the desktop photo library and packing feed live-refresh; the
 * notifier here just refreshes this device's caches.
 */
export function PackerPhotoCaptureSurface({
  packerLogId,
  orderId,
  headerLabel,
  returnHref,
  maxPhotos = 10,
}: PackerPhotoCaptureSurfaceProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  useClearPackerDoneOnUnmount();

  const returnToPack = useCallback(() => {
    router.replace(returnHref);
  }, [router, returnHref]);

  const priorQueryKey = useMemo(
    () => ['packer-photos', packerLogId, 'capture-prior'] as const,
    [packerLogId],
  );

  useEffect(() => {
    packerPhotoUploadQueue.configureNotifier((notice) => {
      queryClient.invalidateQueries({ queryKey: priorQueryKey });
      queryClient.invalidateQueries({ queryKey: ['packer-photos', notice.packerLogId] });
      queryClient.invalidateQueries({ queryKey: ['packer-logs-mobile'] });
    });
  }, [priorQueryKey, queryClient]);

  const scope = useMemo<PackerPhotoScope>(
    () => ({ packerLogId, orderId }),
    [packerLogId, orderId],
  );

  const { data: existingPhotos } = useQuery<{ photos: { id: number; photoUrl: string }[] }>({
    queryKey: priorQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ packerLogId: String(packerLogId) });
      const res = await fetch(`/api/packing-photos?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) return { photos: [] };
      return res.json();
    },
    staleTime: 10_000,
  });

  const [priorPhotos, setPriorPhotos] = useState<PriorPhoto[]>([]);

  useEffect(() => {
    setPriorPhotos(
      (existingPhotos?.photos ?? [])
        .filter((p) => !!p.photoUrl?.trim())
        .map((p) => ({
          id: `prior-${p.id}`,
          photoId: p.id,
          previewUrl: p.photoUrl,
        })),
    );
  }, [existingPhotos]);

  const handleDeletePrior = useCallback(
    async (photoId: number) => {
      const res = await fetch(`/api/packing-photos?id=${photoId}`, { method: 'DELETE' });
      if (res.ok) {
        setPriorPhotos((prev) => prev.filter((p) => p.photoId !== photoId));
        queryClient.invalidateQueries({ queryKey: priorQueryKey });
        queryClient.invalidateQueries({ queryKey: ['packer-photos', packerLogId] });
        queryClient.invalidateQueries({ queryKey: ['packer-logs-mobile'] });
      }
    },
    [packerLogId, priorQueryKey, queryClient],
  );

  const handleDone = useCallback(
    (shots: CapturedShot[]) => {
      if (shots.length === 0) {
        returnToPack();
        return;
      }
      const existingCount = existingPhotos?.photos?.length ?? 0;
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
    [existingPhotos?.photos?.length, returnToPack, scope],
  );

  return (
    <MobilePackerSpamCamera
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
