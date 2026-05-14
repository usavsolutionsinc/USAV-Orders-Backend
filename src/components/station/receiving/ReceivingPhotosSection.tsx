'use client';

import { Loader2 } from '@/components/Icons';
import { useQuery } from '@tanstack/react-query';
import { PhotoGallery } from '@/components/shipped/PhotoGallery';

interface ReceivingPhoto {
  id: number;
  receivingId: number;
  photoUrl: string;
  caption: string | null;
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
  const { data: photos = [], isFetching } = useQuery<ReceivingPhoto[]>({
    queryKey: ['receiving-photos', receivingId],
    queryFn: async () => {
      const res = await fetch(`/api/receiving-photos?receivingId=${receivingId}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.photos) ? data.photos : [];
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const urls = photos.map((p) => p.photoUrl).filter(Boolean);
  const loadingEmpty = isFetching && urls.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <div className="flex items-center gap-2">
            <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-900">{sectionTitle}</h3>
            {isFetching ? <Loader2 className="h-3 w-3 animate-spin text-gray-400" aria-hidden /> : null}
          </div>
        </div>
      </div>

      {loadingEmpty ? (
        <div className="flex h-24 items-center justify-center rounded-xl border border-gray-100 bg-gray-50">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" aria-label="Loading photos" />
        </div>
      ) : urls.length === 0 ? (
        <div className="flex min-h-[5.5rem] items-center justify-center rounded-xl border-2 border-dashed border-gray-100 bg-gray-50 px-4">
          <div className="text-center">
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">No photos yet</p>
            <p className="mt-1 text-[9px] font-medium text-gray-400">
              Mobile app → Receiving → ID <span className="font-mono font-black">#{receivingId}</span>
            </p>
          </div>
        </div>
      ) : (
        <PhotoGallery photos={urls} orderId={downloadLabel ?? `recv-${receivingId}`} launcherTitle={launcherTitle} />
      )}
    </div>
  );
}
