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
  photoUploadQueue,
  useClearDoneOnUnmount,
  type PhotoScope,
} from '@/components/mobile/receiving/PhotoUploadQueue';
import { deleteNasPhoto, isNasPhotoUrl } from '@/lib/nas-photos';
import { normalizePhotoDisplayUrl } from '@/lib/nas-photo-url';
import { useAblyClient } from '@/contexts/AblyContext';
import { useAuth } from '@/contexts/AuthContext';
import { safeChannelName, getPhoneBridgeChannelName } from '@/lib/realtime/channels';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';

interface PhotoCaptureSurfaceProps {
  /** PO receiving package id — required (every photo binds to a receiving row). */
  receivingId: number;
  /** Optional receiving_line id; when set, photos are tagged as item-scoped. */
  receivingLineId?: number | null;
  /** Subtitle line for the camera header ("PO 4421" or "PO 4421 · Item SG350-10"). */
  headerLabel: string;
  /**
   * Human PO reference (Zoho PO number / id) used to name the saved photo
   * object — the photo lands as `{poRef}__….jpg`. Falls back to the package id
   * when unset.
   */
  poRef?: string | null;
  /** Where to send the user after they tap Done — typically the previous detail screen. */
  returnHref: string;
  /** Hard cap on a single capture batch. Defaults to 12. */
  maxPhotos?: number;
  /** Desktop scan flow — echoed on `receiving_photo_uploaded` for the workstation. */
  requestId?: string | null;
}

/**
 * Shared photo capture surface for PO-level and line-level scopes.
 *
 * On the green check-mark, shots enqueue into {@link PhotoUploadQueue}
 * (downscale → POST /api/photos/upload → storage)
 * and the operator returns to the unbox/detail screen immediately while uploads
 * finish in the background.
 *
 * Each committed upload publishes `receiving_photo_uploaded` so the photo
 * strip and Take Photos `x{n}` count refresh on this device and the desktop.
 */
export function PhotoCaptureSurface({
  receivingId,
  receivingLineId = null,
  headerLabel,
  poRef = null,
  returnHref,
  maxPhotos = 12,
  requestId = null,
}: PhotoCaptureSurfaceProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  useClearDoneOnUnmount();

  const { getClient } = useAblyClient();
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const notifyStaffId = user?.staffId ?? 0;
  const phoneChannelName = safeChannelName(() => getPhoneBridgeChannelName(orgId!, notifyStaffId));

  const returnToUnbox = useCallback(() => {
    // Replace instead of push so the capture page does not stay behind in the
    // history stack after the operator exits with X or the checkmark.
    router.replace(returnHref);
  }, [router, returnHref]);

  useEffect(() => {
    if (notifyStaffId <= 0 || !phoneChannelName) return;
    photoUploadQueue.configureNotifier(async (notice) => {
      try {
        invalidateReceivingFeeds(queryClient);
        queryClient.invalidateQueries({
          queryKey: ['receiving-photos', notice.receivingId],
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

  const scope = useMemo<PhotoScope>(
    () => ({ receivingId, receivingLineId, poRef }),
    [receivingId, receivingLineId, poRef],
  );

  const priorQueryKey = useMemo(
    () => ['receiving-photos', receivingId, receivingLineId ?? 'po', 'capture-prior'] as const,
    [receivingId, receivingLineId],
  );

  const { data: existingPhotos } = useQuery<{ photos: { id: number; photoUrl: string }[] }>({
    queryKey: priorQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ receivingId: String(receivingId) });
      if (receivingLineId != null) {
        params.set('receivingLineId', String(receivingLineId));
      } else {
        params.set('scope', 'po');
      }
      const res = await fetch(`/api/receiving-photos?${params.toString()}`, { cache: 'no-store' });
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
          previewUrl: normalizePhotoDisplayUrl(p.photoUrl),
        })),
    );
  }, [existingPhotos]);

  const handleDeletePrior = useCallback(
    async (photoId: number) => {
      const row = existingPhotos?.photos?.find((p) => p.id === photoId);
      const displayUrl = row ? normalizePhotoDisplayUrl(row.photoUrl) : '';
      if (displayUrl && isNasPhotoUrl(displayUrl)) {
        const nasDel = await deleteNasPhoto(displayUrl);
        if (!nasDel.ok) console.warn('NAS file delete failed:', nasDel.error);
      }
      const res = await fetch(`/api/photos/${photoId}`, { method: 'DELETE' });
      if (res.ok) {
        setPriorPhotos((prev) => prev.filter((p) => p.photoId !== photoId));
        queryClient.invalidateQueries({ queryKey: priorQueryKey });
        queryClient.invalidateQueries({ queryKey: ['receiving-photos', receivingId] });
        invalidateReceivingFeeds(queryClient);
      }
    },
    [existingPhotos?.photos, priorQueryKey, queryClient, receivingId],
  );

  const handleDone = useCallback(
    (shots: CapturedShot[]) => {
      if (shots.length === 0) {
        returnToUnbox();
        return;
      }
      const existingCount = existingPhotos?.photos?.length ?? 0;
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
      returnToUnbox();
    },
    [existingPhotos?.photos?.length, returnToUnbox, scope],
  );

  const handleCancel = useCallback(() => {
    returnToUnbox();
  }, [returnToUnbox]);

  return (
    <MobilePackerSpamCamera
      onDone={handleDone}
      onCancel={handleCancel}
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
