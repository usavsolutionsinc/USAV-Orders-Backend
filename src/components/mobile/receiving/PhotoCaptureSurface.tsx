'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
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

interface PhotoCaptureSurfaceProps {
  /** PO receiving package id — required (every photo binds to a receiving row). */
  receivingId: number;
  /** Optional receiving_line id; when set, photos are tagged as item-scoped. */
  receivingLineId?: number | null;
  /** Subtitle line for the camera header ("PO 4421" or "PO 4421 · Item SG350-10"). */
  headerLabel: string;
  /**
   * Human PO reference (Zoho PO number / id) used to name the saved NAS file —
   * the photo lands as `{poRef}__….jpg`. Falls back to the package id when unset.
   */
  poRef?: string | null;
  /** Where to send the user after they tap Done — typically the previous detail screen. */
  returnHref: string;
  /** Hard cap on a single capture batch. Defaults to 12. */
  maxPhotos?: number;
}

/**
 * Shared photo capture surface for both PO-level and Purchase Order Item-level
 * scopes. Owns three responsibilities:
 *   1) Drive the rapid-capture camera (`MobilePackerSpamCamera`).
 *   2) Push captured blobs into the PhotoUploadQueue, which downscales to 720p
 *      and posts to /api/receiving-photos in the background.
 *   3) Render a thumbnail strip with per-photo state (queued/uploading/done/
 *      failed) and a retry affordance for failures.
 *
 * The user can leave this screen while uploads are still in flight — the
 * queue is a module-level singleton so navigating away doesn't kill the
 * pending POSTs.
 */
export function PhotoCaptureSurface({
  receivingId,
  receivingLineId = null,
  headerLabel,
  poRef = null,
  returnHref,
  maxPhotos = 12,
}: PhotoCaptureSurfaceProps) {
  const router = useRouter();
  useClearDoneOnUnmount();

  // Point the upload queue at the active (test/prod) NAS + this operator's
  // folder so captured photos write straight to the NAS share.
  const nas = useNasConfig();
  useEffect(() => {
    if (nas) photoUploadQueue.configureNas(nas);
  }, [nas]);

  const scope = useMemo<PhotoScope>(
    () => ({ receivingId, receivingLineId, poRef }),
    [receivingId, receivingLineId, poRef],
  );

  const handleDone = useCallback(
    (shots: CapturedShot[]) => {
      shots.forEach((s) => {
        photoUploadQueue.enqueue(scope, s.blob, s.previewUrl);
      });
      // Camera takes ownership of the object URLs by enqueueing them;
      // the queue revokes URLs when entries are cleared.
      router.push(returnHref);
    },
    [scope, router, returnHref],
  );

  const handleCancel = useCallback(() => {
    router.push(returnHref);
  }, [router, returnHref]);

  return (
    <MobilePackerSpamCamera
      onDone={handleDone}
      onCancel={handleCancel}
      maxPhotos={maxPhotos}
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
