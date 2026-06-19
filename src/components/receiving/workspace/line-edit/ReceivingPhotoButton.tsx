'use client';

/**
 * Compact carton-photos control for the condensed CartonContextCard row.
 *
 * Replaces the full-width "Click to add photos" strip with a single camera
 * affordance:
 *   • No photos  → camera + "+" button; click opens the NAS picker.
 *   • N photos   → camera + "×N" button; hovering reveals a popover that hosts
 *     the existing PhotoGallery toolbar (thumbnail → fullscreen viewer, delete,
 *     download) plus "Add photos". Per the spec, the hover panel only appears
 *     when photos are actually attached.
 *
 * Shares the `['receiving-photos', receivingId]` query key + the NAS picker /
 * PhotoGallery with {@link ReceivingPhotoStrip} (still used on mobile), so the
 * data and viewer behaviour are identical — this is purely a denser launcher.
 */

import { memo, useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useReceivingPhotosRealtimeRefresh } from '@/hooks/useReceivingPhotosRealtimeRefresh';
import { useAuth } from '@/contexts/AuthContext';
import { useNasConfig } from '@/hooks/useNasConfig';
import { PhotoGallery } from '@/components/shipped/PhotoGallery';
import { NasPickerDialog } from '@/components/sidebar/NasReceivingAttach';
import { nasConfigured } from '@/lib/nas-photos';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';
import { Camera, Plus } from '@/components/Icons';

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
  // Seed the runtime NAS base URL so nasConfigured() reads true on first paint.
  useNasConfig();
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const queryClient = useQueryClient();
  const queryKey = ['receiving-photos', receivingId];
  const [pickerOpen, setPickerOpen] = useState(false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, receivingId]);

  useReceivingPhotosRealtimeRefresh(receivingId, staffId, refresh, staffId > 0 && !!orgId);

  const photos = useMemo(
    () =>
      (data?.photos ?? [])
        .filter((p) => !!p.photoUrl?.trim())
        .map((p) => ({ id: p.id, url: p.photoUrl })),
    [data],
  );

  const adapterUpload =
    process.env.NEXT_PUBLIC_PHOTOS_UPLOAD_PROVIDER === 'adapter';
  const canAdd = nasConfigured() || adapterUpload;
  const count = photos.length;
  const poCreatedAt = data?.receivingCreatedAt ?? null;
  const initialFolder = data?.initialNasFolder ?? '';

  const btnBase =
    'inline-flex h-8 shrink-0 items-center gap-1 self-center rounded-lg px-2.5 text-caption font-black tabular-nums shadow-sm transition-colors';

  // Empty state — camera + "+", click opens the picker (no hover panel).
  if (count === 0) {
    return (
      <>
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => canAdd && setPickerOpen(true)}
          title={canAdd ? 'Add photos to this package' : 'No photos — NAS not configured'}
          aria-label="Add photos"
          className={`${btnBase} border border-dashed border-gray-300 bg-white text-gray-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-40`}
        >
          <Camera className="h-4 w-4" />
          <Plus className="h-3 w-3" />
        </button>
        {canAdd && pickerOpen ? (
          <NasPickerDialog
            receivingId={receivingId}
            poCreatedAt={poCreatedAt}
            initialFolder={initialFolder}
            onClose={() => setPickerOpen(false)}
            onAttached={refresh}
          />
        ) : null}
      </>
    );
  }

  // With photos — camera + ×N; hovering reveals the gallery toolbar + add.
  return (
    <div className="group/photos relative shrink-0">
      <button
        type="button"
        aria-haspopup="true"
        title={`${count} photo${count === 1 ? '' : 's'} — hover for options`}
        className={`${btnBase} border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100`}
      >
        <Camera className="h-4 w-4" />
        ×{count}
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
            onAddPhotos={canAdd ? () => setPickerOpen(true) : undefined}
          />
        </div>
      </div>
      {canAdd && pickerOpen ? (
        <NasPickerDialog
          receivingId={receivingId}
          poCreatedAt={poCreatedAt}
          initialFolder={initialFolder}
          onClose={() => setPickerOpen(false)}
          onAttached={refresh}
        />
      ) : null}
    </div>
  );
});

export default ReceivingPhotoButton;
