'use client';

/**
 * Compact carton-photos control for the condensed CartonContextCard row.
 *
 * The button is always the send-to-phone trigger (camera + "+"), whether or not
 * photos exist yet — capture happens on mobile. Once photos exist it also shows
 * the count (×N) and hovering reveals the read/delete gallery toolbar.
 */

import { memo, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAblyClient } from '@/contexts/AblyContext';
import { useReceivingPhotosRealtimeRefresh } from '@/hooks/useReceivingPhotosRealtimeRefresh';
import { useAuth } from '@/contexts/AuthContext';
import { PhotoGallery } from '@/components/shipped/PhotoGallery';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';
import { Camera, Plus } from '@/components/Icons';
import { publishReceivingPhotoRequest } from '@/lib/realtime/receiving-photo-request';
import { toast } from '@/lib/toast';

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
  receivingCreatedAt?: string | null;
  initialNasFolder?: string | null;
}

export const ReceivingPhotoButton = memo(function ReceivingPhotoButton({
  receivingId,
  staffId,
}: {
  receivingId: number;
  staffId: number;
}) {
  const { getClient } = useAblyClient();
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const queryClient = useQueryClient();
  const queryKey = ['receiving-photos', receivingId];

  const { data } = useQuery<PhotosPayload>({
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

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
    invalidateReceivingFeeds(queryClient);
  }, [queryClient, queryKey]);

  useReceivingPhotosRealtimeRefresh(receivingId, staffId, refresh, staffId > 0 && !!orgId);

  const handleRequestOnPhone = useCallback(async () => {
    try {
      const client = await getClient();
      await publishReceivingPhotoRequest(client, orgId, staffId, receivingId);
      toast.success('Sent to phone');
    } catch (err) {
      console.warn('receiving-photo-button: photo request publish failed', err);
      toast.error('Could not send to phone');
    }
  }, [getClient, orgId, receivingId, staffId]);

  const photos = useMemo(
    () =>
      (data?.photos ?? [])
        .filter((p) => !!p.photoUrl?.trim())
        .map((p) => ({ id: p.id, url: p.photoUrl })),
    [data],
  );

  const count = photos.length;

  const btnBase =
    'inline-flex h-8 shrink-0 items-center gap-1 self-center rounded-lg px-2.5 text-caption font-black tabular-nums shadow-sm transition-colors';

  // Empty state — camera + "+", display only. Capture now happens on mobile.
  if (count === 0) {
    return (
      <button
        type="button"
        onClick={handleRequestOnPhone}
        title="Send to phone to take photos"
        aria-label="Send to phone to take photos"
        className={`${btnBase} border border-blue-200 bg-blue-50 text-blue-700 transition-colors hover:bg-blue-100`}
      >
        <Camera className="h-4 w-4" />
        <Plus className="h-3 w-3" />
      </button>
    );
  }

  // With photos — camera + ×N + "+"; the button itself still sends to phone
  // (the "+" affordance stays even once photos exist), and hovering reveals the
  // gallery toolbar for viewing/deleting. The in-popover add button is gone —
  // send-to-phone now lives on this top-bar button only.
  return (
    <div className="group/photos relative shrink-0">
      <button
        type="button"
        onClick={handleRequestOnPhone}
        title={`${count} photo${count === 1 ? '' : 's'} — click "+" to send to phone, hover for options`}
        aria-label={`${count} photo${count === 1 ? '' : 's'}; send to phone to add more`}
        className={`${btnBase} border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100`}
      >
        <Camera className="h-4 w-4" />
        ×{count}
        <Plus className="h-3 w-3" />
      </button>
      {/* Hover popover. `pt-1.5` is inside the group so the gap between button
          and card doesn't drop the hover. Only rendered when photos exist. */}
      <div className="invisible absolute right-0 top-full z-30 pt-1.5 opacity-0 transition-opacity duration-100 group-hover/photos:visible group-hover/photos:opacity-100">
        <div className="w-fit max-w-[80vw] rounded-xl border border-gray-200 bg-white p-1 shadow-xl">
          <PhotoGallery
            photos={photos}
            orderId={`RCV-${receivingId}`}
            launcherLayout="toolbar"
            showCopyLinks={false}
            toolbarShowLabel={false}
            compact
            libraryHref={`/ops/photos?receivingId=${receivingId}`}
            onPhotoDeleted={refresh}
          />
        </div>
      </div>
    </div>
  );
});

export default ReceivingPhotoButton;
