'use client';

import { Camera, Loader2, X } from '@/components/Icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';

interface ReceivingPhoto {
  id: number;
  receivingId: number;
  photoUrl: string;
  caption: string | null;
}

interface ReceivingPhotosSectionProps {
  receivingId: string;
}

export function ReceivingPhotosSection({ receivingId }: ReceivingPhotosSectionProps) {
  const queryClient = useQueryClient();

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

  const deletePhoto = async (photoId: number) => {
    await fetch(`/api/receiving-photos?id=${photoId}`, { method: 'DELETE' });
    queryClient.invalidateQueries({ queryKey: ['receiving-photos', receivingId] });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Camera className="h-4 w-4 text-gray-400" />
        <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">
          Photos ({photos.length})
        </span>
        {isFetching && <Loader2 className="h-3 w-3 animate-spin text-gray-300" />}
      </div>

      {photos.length === 0 ? (
        <div className="flex h-24 items-center justify-center rounded-2xl border-2 border-dashed border-gray-100 bg-gray-50">
          <div className="text-center">
            <Camera className="mx-auto mb-1 h-5 w-5 text-gray-300" />
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-300">No photos yet</p>
            <p className="text-[9px] font-medium text-gray-300">
              Mobile app → Receiving → ID <span className="font-mono font-black">#{receivingId}</span>
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-xl bg-gray-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.photoUrl} alt={photo.caption || `Photo ${photo.id}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => deletePhoto(photo.id)}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
