'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { PhotoGallery } from '@/components/shipped/PhotoGallery';

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
  staffId: number;
}

/**
 * Receiving carton photos — same launcher + full-screen viewer as shipped
 * packing photos ({@link PhotoGallery}).
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

  const phoneChannel = staffId > 0 ? `phone:${staffId}` : 'phone:__idle__';
  const handlePhoneMessage = useCallback(
    (msg: { data?: { receiving_id?: number } }) => {
      const incoming = Number(msg?.data?.receiving_id);
      if (!Number.isFinite(incoming) || incoming !== receivingId) return;
      queryClient.invalidateQueries({ queryKey });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [receivingId, queryClient],
  );
  useAblyChannel(phoneChannel, 'receiving_photo_uploaded', handlePhoneMessage, staffId > 0);

  const urls = (data?.photos ?? []).map((p) => p.photoUrl).filter((u) => u && u.trim());

  if (isLoading && urls.length === 0) {
    return (
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
        Loading photos…
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-[10px] font-bold text-rose-500 uppercase tracking-widest">
        Photo load failed
      </div>
    );
  }

  return (
    <PhotoGallery
      photos={urls}
      orderId={`RCV-${receivingId}`}
      launcherLayout="toolbar"
    />
  );
}
