'use client';

/**
 * Compact carton-photos control for the condensed CartonContextCard row.
 *
 * One pill: camera + (×N when photos exist) + "+". Click sends a capture
 * request to the paired phone. When photos exist, hovering the pill reveals
 * the read/delete gallery toolbar — the wrapper owns hover (with a short leave
 * delay) so the cursor can cross the gap to the popover without it collapsing.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAblyClient } from '@/contexts/AblyContext';
import { useReceivingPhotosRealtimeRefresh } from '@/hooks/useReceivingPhotosRealtimeRefresh';
import { useAuth } from '@/contexts/AuthContext';
import { PhotoGallery } from '@/components/shipped/PhotoGallery';
import { receivingPhotosQueryKey, refreshReceivingPhotos } from '@/lib/queries/receiving-queries';
import { Camera, Plus } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
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

const HOVER_LEAVE_MS = 140;

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
  const queryKey = receivingPhotosQueryKey(receivingId);

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

  const refresh = useCallback(
    (deletedPhotoId?: number) => {
      refreshReceivingPhotos(queryClient, receivingId, deletedPhotoId);
    },
    [queryClient, receivingId],
  );

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
  const [galleryHover, setGalleryHover] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();

  const openGallery = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (count > 0) setGalleryHover(true);
  }, [count]);

  const scheduleCloseGallery = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setGalleryHover(false), HOVER_LEAVE_MS);
  }, []);

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  const btnClass =
    'h-8 shrink-0 gap-1 self-center rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-caption font-black tabular-nums text-blue-700 shadow-sm hover:bg-blue-100 hover:text-blue-700';

  const title =
    count > 0
      ? `${count} photo${count === 1 ? '' : 's'} — click to send to phone, hover for gallery`
      : 'Send to phone to take photos';

  const ariaLabel =
    count > 0
      ? `${count} carton photo${count === 1 ? '' : 's'}; send to phone or hover for gallery`
      : 'Send to phone to take photos';

  return (
    <div
      className="relative shrink-0"
      onMouseEnter={openGallery}
      onMouseLeave={scheduleCloseGallery}
      onFocusCapture={openGallery}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) scheduleCloseGallery();
      }}
    >
      <HoverTooltip label={title} asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleRequestOnPhone}
          ariaLabel={ariaLabel}
          aria-expanded={count > 0 ? galleryHover : undefined}
          icon={<Camera className="h-4 w-4" />}
          iconRight={<Plus className="h-3 w-3" />}
          className={btnClass}
        >
          {count > 0 ? <>×{count}</> : null}
        </Button>
      </HoverTooltip>

      {count > 0 && galleryHover ? (
        // `pt-1.5` bridges the gap so the pointer stays inside the hover target
        // while moving from the pill to the gallery card.
        <div className="absolute right-0 top-full z-30 pt-1.5">
          <div className="w-fit max-w-[80vw] rounded-xl border border-gray-200 bg-white p-1 shadow-xl">
            <PhotoGallery
              photos={photos}
              orderId={`RCV-${receivingId}`}
              receivingId={receivingId}
              launcherLayout="toolbar"
              showCopyLinks={false}
              toolbarShowLabel={false}
              compact
              libraryHref={`/ops/photos?receivingId=${receivingId}`}
              onPhotoDeleted={(photoId) => refresh(photoId)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
});

export default ReceivingPhotoButton;
