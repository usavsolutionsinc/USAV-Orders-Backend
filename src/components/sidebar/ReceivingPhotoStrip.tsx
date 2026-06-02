'use client';

import { memo, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { PhotoGallery } from '@/components/shipped/PhotoGallery';
import { NasReceivingAttach } from '@/components/sidebar/NasReceivingAttach';

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
export const ReceivingPhotoStrip = memo(function ReceivingPhotoStrip({
  receivingId,
  staffId,
}: ReceivingPhotoStripProps) {
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

  const galleryPhotos = useMemo(
    () =>
      (data?.photos ?? [])
        .filter((p) => !!p.photoUrl?.trim())
        .map((p) => ({ id: p.id, url: p.photoUrl })),
    [data],
  );

  if (isLoading && galleryPhotos.length === 0) {
    return (
      <div className="text-micro font-bold text-gray-400 uppercase tracking-widest">
        Loading photos…
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-micro font-bold text-rose-500 uppercase tracking-widest">
        Photo load failed
      </div>
    );
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  return (
    <div className="space-y-2">
      <NasReceivingAttach receivingId={receivingId} onAttached={refresh} />
      {galleryPhotos.length > 0 ? (
        <PhotoGallery
          photos={galleryPhotos}
          orderId={`RCV-${receivingId}`}
          launcherLayout="toolbar"
          onPhotoDeleted={refresh}
        />
      ) : (
        <p className="text-micro font-bold uppercase tracking-widest text-gray-400">
          No photos yet — pair some from the NAS.
        </p>
      )}
    </div>
  );
});
