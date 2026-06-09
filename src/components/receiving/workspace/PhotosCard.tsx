'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { Camera, Smartphone } from '@/components/Icons';
import { PhotoGallery } from '@/components/shipped/PhotoGallery';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';

interface PhotoRow {
  id: number;
  receivingId: number;
  photoUrl: string;
  caption: string | null;
  uploadedBy: number | null;
  createdAt: string;
}

interface PhotosPayload {
  photos: PhotoRow[];
}

interface Props {
  receivingId: number | null;
  staffId: number;
  /** Click handler for the "Make a claim" CTA. Opens ReceivingClaimModal. */
  onMakeClaim?: () => void;
}

/**
 * Workspace photo strip. Wraps the same data + Ably bridge that
 * `ReceivingPhotoStrip` uses, but inside the new WorkspaceCard frame and
 * with a "Make a claim" CTA next to "Open on phone".
 *
 * Phone-side photo capture is already auto-triggered by the sidebar's
 * publish on a fresh scan; the "Open on phone" button here is a manual
 * re-request fallback for when the phone got disconnected mid-flow.
 */
export function PhotosCard({ receivingId, staffId, onMakeClaim }: Props) {
  const queryClient = useQueryClient();
  const enabled = Number.isFinite(receivingId) && (receivingId ?? 0) > 0;
  const queryKey = ['receiving-photos', receivingId] as const;

  const { data, isLoading } = useQuery<PhotosPayload>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/receiving-photos?receivingId=${receivingId}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled,
    staleTime: 10_000,
  });

  // Phone uploads → invalidate the cache so the strip reflects new shots.
  const phoneChannel = staffId > 0 ? `phone:${staffId}` : 'phone:__idle__';
  const handlePhoneMessage = useCallback(
    (msg: { data?: { receiving_id?: number } }) => {
      const incoming = Number(msg?.data?.receiving_id);
      if (!Number.isFinite(incoming) || incoming !== receivingId) return;
      queryClient.invalidateQueries({ queryKey });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queryKey identity is stable per receivingId
    [receivingId, queryClient],
  );
  useAblyChannel(phoneChannel, 'receiving_photo_uploaded', handlePhoneMessage, staffId > 0);

  const galleryPhotos = useMemo(
    () =>
      (data?.photos ?? [])
        .filter((p) => !!p.photoUrl?.trim())
        .map((p) => ({ id: p.id, url: p.photoUrl })),
    [data],
  );

  const handleRequestOnPhone = useCallback(() => {
    if (!enabled) return;
    // Re-emit the same event the sidebar uses on first scan so the operator
    // can manually re-prompt the phone if it got disconnected.
    window.dispatchEvent(
      new CustomEvent('receiving-request-photos', {
        detail: { receivingId },
      }),
    );
  }, [enabled, receivingId]);

  const count = galleryPhotos.length;
  const countClass =
    count === 0
      ? 'bg-gray-50 text-gray-500 ring-gray-200'
      : 'bg-blue-50 text-blue-700 ring-blue-200';

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200/60">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-caption font-bold uppercase tracking-[0.14em] text-gray-500">
          <Camera className="h-3 w-3" />
          Photos
        </h3>
        <span
          className={`rounded-md px-2 py-0.5 text-micro font-black uppercase tracking-widest ring-1 ${countClass}`}
        >
          {count} {count === 1 ? 'photo' : 'photos'}
        </span>
      </div>

      {!enabled ? (
        <p className="text-caption font-semibold text-gray-400">
          Scan a tracking number to receive photos.
        </p>
      ) : isLoading && galleryPhotos.length === 0 ? (
        <div className="grid grid-cols-4 gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="aspect-square w-full animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : galleryPhotos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-5 text-center">
          <p className="text-caption font-bold uppercase tracking-widest text-gray-400">
            No photos yet
          </p>
          <p className="mt-1 text-micro font-semibold leading-snug text-gray-500">
            The phone will auto-capture as the package is unboxed.
          </p>
        </div>
      ) : (
        <PhotoGallery
          photos={galleryPhotos}
          orderId={`RCV-${receivingId}`}
          launcherLayout="toolbar"
          onPhotoDeleted={() => {
            queryClient.invalidateQueries({ queryKey });
            invalidateReceivingFeeds(queryClient);
          }}
        />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleRequestOnPhone}
          disabled={!enabled}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-caption font-bold uppercase tracking-widest text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Smartphone className="h-3.5 w-3.5" />
          Open on phone
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onMakeClaim}
          disabled={!enabled || !onMakeClaim}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-caption font-bold uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Make a claim →
        </button>
      </div>
    </section>
  );
}
