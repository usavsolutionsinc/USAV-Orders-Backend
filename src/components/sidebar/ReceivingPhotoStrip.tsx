'use client';

import { memo, useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { useAuth } from '@/contexts/AuthContext';
import { safeChannelName, getPhoneBridgeChannelName } from '@/lib/realtime/channels';
import { PhotoGallery } from '@/components/shipped/PhotoGallery';
import { NasReceivingAttach, NasPickerDialog } from '@/components/sidebar/NasReceivingAttach';
import { nasConfigured } from '@/lib/nas-photos';
import { normalizePhotoDisplayUrl } from '@/lib/nas-photo-url';
import { useNasConfig } from '@/hooks/useNasConfig';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';
import { SkeletonBase } from '@/design-system/components/Skeletons';

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
  /** When this carton was scanned/created — anchors the NAS picker's default sort. */
  receivingCreatedAt?: string | null;
  /** Admin-configured folder for the operator's station — the picker opens here. */
  initialNasFolder?: string | null;
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
  const { user } = useAuth();
  const orgId = user?.organizationId;
  // Seed the runtime NAS base URL (admin test/prod setting) and re-render once it
  // resolves. Without this, nasConfigured() reads an empty base on first render
  // and the empty state falls back to "No photos yet." instead of the
  // "Click to add photos" NAS dropzone — NasReceivingAttach loads the config too,
  // but it's gated out below before it can mount (chicken-and-egg).
  useNasConfig();
  const queryKey = ['receiving-photos', receivingId];
  // NAS picker for adding more photos once some already exist. Owned here (not
  // inside PhotoGallery) so it portals above the fullscreen viewer.
  const [pickerOpen, setPickerOpen] = useState(false);

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

  const phoneChannel = safeChannelName(() => getPhoneBridgeChannelName(orgId!, staffId));
  const handlePhoneMessage = useCallback(
    (msg: { data?: { receiving_id?: number } }) => {
      const incoming = Number(msg?.data?.receiving_id);
      if (!Number.isFinite(incoming) || incoming !== receivingId) return;
      queryClient.invalidateQueries({ queryKey });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [receivingId, queryClient],
  );
  useAblyChannel(phoneChannel, 'receiving_photo_uploaded', handlePhoneMessage, !!phoneChannel && staffId > 0);

  const galleryPhotos = useMemo(
    () =>
      (data?.photos ?? [])
        .filter((p) => !!p.photoUrl?.trim())
        .map((p) => ({ id: p.id, url: normalizePhotoDisplayUrl(p.photoUrl) })),
    [data],
  );

  if (isLoading && galleryPhotos.length === 0) {
    // Mirror the loaded compact toolbar's footprint (`min-h-9`: thumbnail
    // launcher · label · trailing action buttons) so the row keeps the exact
    // same height once photos land — no reflow, and the sibling Claim button
    // never shifts. Reuses the shared `SkeletonBase` shimmer for consistency.
    return (
      <div className="flex min-h-9 items-center gap-2 py-0.5" aria-hidden>
        <SkeletonBase width="28px" height="28px" className="rounded-lg" />
        <SkeletonBase width="40%" height="0.625rem" />
        <div className="ml-auto flex items-center gap-1.5">
          <SkeletonBase width="28px" height="28px" className="rounded-lg" />
          <SkeletonBase width="28px" height="28px" className="rounded-lg" />
        </div>
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

  // Refetch the strip AND every receiving feed so the Take Photos button's
  // `x{n}` count stays in sync after an attach or a delete (the feeds carry
  // `photo_count`, which the strip's own query key doesn't touch).
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey });
    invalidateReceivingFeeds(queryClient);
  };
  const poCreatedAt = data?.receivingCreatedAt ?? null;
  const initialFolder = data?.initialNasFolder ?? '';

  // Empty state: a single full-width "click to add photos" dropzone (when the
  // NAS is configured). With photos: a compact attach button above the gallery.
  if (galleryPhotos.length === 0) {
    return nasConfigured() ? (
      <NasReceivingAttach
        receivingId={receivingId}
        poCreatedAt={poCreatedAt}
        initialFolder={initialFolder}
        onAttached={refresh}
        fullWidth
        label="Click to add photos"
      />
    ) : (
      <p className="text-micro font-bold uppercase tracking-widest text-gray-400">
        No photos yet.
      </p>
    );
  }

  // With photos present, the gallery's own toolbar (and the fullscreen viewer)
  // surface an "Add photos" button when the NAS is configured. The picker dialog
  // is rendered here so it layers above the gallery's fullscreen viewer.
  const canAdd = nasConfigured();
  return (
    <>
      <PhotoGallery
        photos={galleryPhotos}
        orderId={`RCV-${receivingId}`}
        launcherLayout="toolbar"
        compact
        onPhotoDeleted={refresh}
        onAddPhotos={canAdd ? () => setPickerOpen(true) : undefined}
      />
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
});
