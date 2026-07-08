'use client';

import { Camera } from '@/components/Icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PhotoGallery } from '@/components/shipped/PhotoGallery';
import { unboxingPhotoMeta } from '@/components/shipped/photo-gallery/photo-gallery-utils';
import { useReceivingPhotosRealtimeRefresh } from '@/hooks/useReceivingPhotosRealtimeRefresh';
import { useAuth } from '@/contexts/AuthContext';

interface ReceivingPhoto {
  id: number;
  receivingId: number;
  photoUrl: string;
  caption: string | null;
  createdAt?: string;
}

interface ReceivingPhotosSectionProps {
  receivingId: string;
  /** Passed to PhotoGallery downloads as `orderId` filename stem. */
  downloadLabel?: string;
  /** Section heading (shipping panel uses “Packing Photos”). */
  sectionTitle?: string;
  /** Primary line on the same launcher affordance shipped uses for packing. */
  launcherTitle?: string;
}

export function ReceivingPhotosSection({
  receivingId,
  downloadLabel,
  sectionTitle = 'Receiving photos',
  launcherTitle = 'View Receiving Photos',
}: ReceivingPhotosSectionProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const staffId = user?.staffId ?? 0;
  const queryKey = ['receiving-photos', receivingId] as const;
  const { data: photos, isFetching } = useQuery<ReceivingPhoto[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/receiving-photos?receivingId=${receivingId}`);
      if (!res.ok) return [];
      const data = await res.json().catch(() => null);
      // Some routes return the array directly, others wrap it as `{ photos }`,
      // and stale cached entries may have been a different shape. Normalize
      // here so the consumer never has to type-check `photos.map`.
      if (Array.isArray(data)) return data as ReceivingPhoto[];
      if (data && Array.isArray((data as { photos?: unknown }).photos)) {
        return (data as { photos: ReceivingPhoto[] }).photos;
      }
      return [];
    },
    // 30s poll is the pickup path for photos uploaded elsewhere (e.g. mobile
    // packer). React Query pauses this while the tab is hidden by default.
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  useReceivingPhotosRealtimeRefresh(
    Number(receivingId),
    staffId,
    () => queryClient.invalidateQueries({ queryKey }),
    staffId > 0,
  );

  // Defensive — `photos` should always be an array per the queryFn, but a
  // stale React Query cache entry from an older shape could be non-array
  // here. Guard against the crash; the queryFn will replace the cache on
  // its next run.
  const photosArr: ReceivingPhoto[] = Array.isArray(photos) ? photos : [];
  const galleryPhotos = photosArr
    .filter((p) => !!p.photoUrl)
    .map((p) => ({
      id: p.id,
      url: p.photoUrl,
      meta: unboxingPhotoMeta({ caption: p.caption, createdAt: p.createdAt }),
    }));
  const loadingEmpty = isFetching && galleryPhotos.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Camera className="h-4 w-4 text-text-muted" aria-hidden />
          <h3 className="text-caption font-black uppercase tracking-widest text-text-default">
            {sectionTitle}
          </h3>
        </div>
      </div>

      {loadingEmpty ? (
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-border-hairline bg-surface-canvas p-2">
          <div className="h-16 rounded-lg bg-surface-sunken" aria-hidden />
          <div className="h-16 rounded-lg bg-surface-sunken" aria-hidden />
          <div className="h-16 rounded-lg bg-surface-sunken" aria-hidden />
          <span className="sr-only">Loading photos</span>
        </div>
      ) : galleryPhotos.length === 0 ? (
        <div className="flex min-h-[5.5rem] items-center justify-center rounded-xl border-2 border-dashed border-border-hairline bg-surface-canvas px-4">
          <div className="text-center">
            <p className="text-eyebrow font-black uppercase tracking-widest text-text-faint">No photos yet</p>
            <p className="mt-1 text-eyebrow font-medium text-text-faint">
              Mobile app → Receiving → ID <span className="font-mono font-black">#{receivingId}</span>
            </p>
          </div>
        </div>
      ) : (
        <PhotoGallery
          photos={galleryPhotos}
          orderId={downloadLabel ?? `recv-${receivingId}`}
          launcherTitle={launcherTitle}
          receivingId={Number(receivingId)}
          allowReassign
          onPhotoDeleted={() => queryClient.invalidateQueries({ queryKey })}
          onPhotoReassigned={() => queryClient.invalidateQueries({ queryKey })}
          onPhotoUploaded={() => queryClient.invalidateQueries({ queryKey })}
        />
      )}
    </div>
  );
}
