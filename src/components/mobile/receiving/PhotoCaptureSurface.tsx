'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Check, RefreshCw, Loader2 } from '@/components/Icons';
import {
  MobilePackerSpamCamera,
  type CapturedShot,
} from '@/components/mobile/station/MobilePackerSpamCamera';
import {
  photoUploadQueue,
  useClearDoneOnUnmount,
  useUploadQueue,
  type PhotoScope,
} from '@/components/mobile/receiving/PhotoUploadQueue';
import { useNasConfig } from '@/hooks/useNasConfig';
import { useAblyClient } from '@/contexts/AblyContext';
import { useAuth } from '@/contexts/AuthContext';

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
 * scopes. Two stages:
 *   1) `camera`  — rapid-capture camera ({@link MobilePackerSpamCamera}). On the
 *      check-mark, shots are pushed into the PhotoUploadQueue (downscale → NAS
 *      WebDAV PUT → POST /api/receiving-photos, in the background).
 *   2) `review`  — a confirmation screen showing every captured shot with its
 *      live upload state (queued / uploading / ✓ uploaded / failed + Retry) and
 *      a running "N uploaded / M" count, so the operator can SEE that the photos
 *      landed in the system before leaving. The queue is a module-level
 *      singleton, so uploads keep going even if they tap Done early.
 *
 * Each committed upload also publishes `receiving_photo_uploaded` (see the
 * notifier wired below), which refreshes the integrated NAS photo strip and the
 * Take Photos button's `x{n}` count on this device and the paired desktop.
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

  const [stage, setStage] = useState<'camera' | 'review'>('camera');

  // Point the upload queue at the active (test/prod) NAS + this operator's
  // folder so captured photos write straight to the NAS share.
  const nas = useNasConfig();
  useEffect(() => {
    if (nas) photoUploadQueue.configureNas(nas);
  }, [nas]);

  // Teach the queue how to broadcast a finished upload: publish
  // `receiving_photo_uploaded` on `phone:{staffId}` so the integrated NAS photo
  // strip (ReceivingPhotoStrip) and the receiving feed's photo counts refresh
  // live — same device (Ably echoes to the publisher) and the paired desktop.
  const { getClient } = useAblyClient();
  const { user } = useAuth();
  const notifyStaffId = user?.staffId ?? 0;
  useEffect(() => {
    if (notifyStaffId <= 0) return;
    photoUploadQueue.configureNotifier(async (notice) => {
      try {
        const client = await getClient();
        if (!client) return;
        const ch = client.channels.get(`phone:${notifyStaffId}`);
        await ch.publish('receiving_photo_uploaded', {
          receiving_id: notice.receivingId,
          receiving_line_id: notice.receivingLineId,
          photo_id: notice.photoId,
          photo_url: notice.photoUrl,
        });
      } catch (err) {
        console.warn('photo queue: receiving_photo_uploaded publish failed', err);
      }
    });
    // No cleanup — the notifier must survive this surface unmounting so a photo
    // that finishes uploading in the background still announces itself.
  }, [getClient, notifyStaffId]);

  const scope = useMemo<PhotoScope>(
    () => ({ receivingId, receivingLineId, poRef }),
    [receivingId, receivingLineId, poRef],
  );

  // Live per-photo upload state for THIS package/line (queue is a singleton).
  const entries = useUploadQueue(scope);

  const handleDone = useCallback(
    (shots: CapturedShot[]) => {
      // No shots taken → just leave (nothing to confirm).
      if (shots.length === 0) {
        router.push(returnHref);
        return;
      }
      shots.forEach((s) => {
        photoUploadQueue.enqueue(scope, s.blob, s.previewUrl);
      });
      // Camera takes ownership of the object URLs by enqueueing them; the queue
      // revokes URLs when entries are cleared. Show the review/confirm screen
      // so the operator can watch the uploads land.
      setStage('review');
    },
    [scope, router, returnHref],
  );

  // Camera back button: return to review when shots already exist (came here via
  // "Take more"), otherwise leave the capture surface entirely.
  const handleCancel = useCallback(() => {
    if (entries.length > 0) setStage('review');
    else router.push(returnHref);
  }, [entries.length, router, returnHref]);

  if (stage === 'camera') {
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

  // ── Stage: review / confirm ────────────────────────────────────────────────
  const total = entries.length;
  const uploaded = entries.filter((e) => e.state === 'done').length;
  const failed = entries.filter((e) => e.state === 'failed').length;
  const allUploaded = total > 0 && uploaded === total;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
          Photos · {headerLabel}
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          <h1 className="text-lg font-black text-slate-900 tabular-nums">
            {uploaded}/{total} uploaded
          </h1>
          {allUploaded ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-caption font-black uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200">
              <Check className="h-3.5 w-3.5" /> In the system
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-caption font-black uppercase tracking-wider text-blue-700 ring-1 ring-blue-200">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
            </span>
          )}
        </div>
        {failed > 0 ? (
          <p className="mt-1 text-caption font-bold text-rose-600">{failed} failed — tap Retry below</p>
        ) : null}
      </header>

      <main className="flex-1 space-y-2 px-4 py-3 pb-28">
        {entries.map((e, i) => (
          <div
            key={e.id}
            className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2 shadow-sm"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={e.photoUrl ?? e.previewUrl}
              alt={`Photo ${i + 1}`}
              className="h-16 w-16 rounded object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="text-caption font-black uppercase tracking-wider text-slate-600">
                Photo {i + 1}
              </p>
              <p
                className={`mt-0.5 text-caption font-bold ${
                  e.state === 'done'
                    ? 'text-emerald-600'
                    : e.state === 'failed'
                    ? 'text-rose-600'
                    : 'text-slate-500'
                }`}
              >
                {e.state === 'queued' && 'Queued'}
                {e.state === 'uploading' && 'Uploading…'}
                {e.state === 'done' && '✓ Uploaded'}
                {e.state === 'failed' && `✗ ${e.error || 'Failed'}`}
              </p>
            </div>
            {e.state === 'failed' ? (
              <button
                type="button"
                onClick={() => photoUploadQueue.retry(e.id)}
                className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-2 text-xs font-bold text-white active:bg-rose-700"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </button>
            ) : null}
          </div>
        ))}
      </main>

      <footer
        className="sticky bottom-0 z-20 grid grid-cols-2 gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-md"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <button
          type="button"
          onClick={() => setStage('camera')}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white text-sm font-black uppercase tracking-wider text-slate-700 active:bg-slate-50"
        >
          <Camera className="h-4 w-4" />
          Take more
        </button>
        <button
          type="button"
          onClick={() => router.push(returnHref)}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-sm font-black uppercase tracking-wider text-white shadow-md shadow-blue-600/30 active:scale-[0.98]"
        >
          <Check className="h-4 w-4" />
          Done
        </button>
      </footer>
    </div>
  );
}
