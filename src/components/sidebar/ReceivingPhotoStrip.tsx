'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { X } from '@/components/Icons';

// ─── Types ──────────────────────────────────────────────────────────────────

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

interface ReceivingPhotoStripProps {
  receivingId: number;
  /** Used to subscribe to `phone:{staffId}` for live refresh on uploads. */
  staffId: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Horizontal thumbnail strip of every photo captured for one receiving
 * carton. Updates in real time when the paired phone publishes a
 * `receiving_photo_uploaded` event on `phone:{staffId}`.
 */
export function ReceivingPhotoStrip({ receivingId, staffId }: ReceivingPhotoStripProps) {
  const queryClient = useQueryClient();
  const queryKey = ['receiving-photos', receivingId];

  const { data, isLoading, error } = useQuery<PhotosPayload>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/receiving-photos?receivingId=${receivingId}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: Number.isFinite(receivingId) && receivingId > 0,
    staleTime: 10_000,
  });

  // Live refresh: phone publishes here after each successful upload.
  const phoneChannel = staffId > 0 ? `phone:${staffId}` : 'phone:__idle__';
  const handlePhoneMessage = useCallback(
    (msg: { data?: { receiving_id?: number } }) => {
      const incoming = Number(msg?.data?.receiving_id);
      if (!Number.isFinite(incoming) || incoming !== receivingId) return;
      queryClient.invalidateQueries({ queryKey });
    },
    // queryKey is a stable array; eslint warns but it's intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [receivingId, queryClient],
  );
  useAblyChannel(phoneChannel, 'receiving_photo_uploaded', handlePhoneMessage, staffId > 0);

  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const photos = data?.photos ?? [];

  // Close lightbox on Escape.
  useEffect(() => {
    if (lightboxIdx == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIdx(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxIdx]);

  if (isLoading && photos.length === 0) {
    return (
      <div className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
        Loading photos…
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-3 py-2 text-[10px] font-bold text-rose-500 uppercase tracking-widest">
        Photo load failed
      </div>
    );
  }
  if (photos.length === 0) {
    return (
      <div className="flex items-center justify-between px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
        <span>No photos yet</span>
        <span className="text-gray-500">📱 take on phone</span>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 overflow-x-auto px-3 py-2">
        <span className="shrink-0 text-[9px] font-black uppercase tracking-[0.18em] text-gray-500">
          {photos.length} photo{photos.length === 1 ? '' : 's'}
        </span>
        <div className="flex gap-1.5">
          {photos.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setLightboxIdx(idx)}
              aria-label={`View photo ${idx + 1}`}
              className="relative h-14 w-14 shrink-0 overflow-hidden rounded border border-gray-200 transition-transform active:scale-95"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.photoUrl}
                alt={`Receiving photo ${idx + 1}`}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      </div>

      {lightboxIdx != null && photos[lightboxIdx] && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightboxIdx(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Photo preview"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxIdx(null);
            }}
            aria-label="Close"
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white active:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photos[lightboxIdx].photoUrl}
            alt={`Receiving photo ${lightboxIdx + 1}`}
            className="max-h-full max-w-full object-contain"
          />
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold text-white">
            {lightboxIdx + 1} / {photos.length}
          </div>
        </div>
      )}
    </>
  );
}
