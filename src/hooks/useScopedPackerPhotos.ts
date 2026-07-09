'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PriorPhoto } from '@/components/mobile/station/MobilePackerSpamCamera';
import type { PackerPhotoScope } from '@/components/mobile/packer/PackerPhotoUploadQueue';

export interface PackerPhotoRow {
  id: number;
  photoUrl: string;
}

export function packerPhotosQueryKey(packerLogId: number) {
  return ['packer-photos', packerLogId, 'capture-prior'] as const;
}

async function fetchPackerPhotos(packerLogId: number): Promise<{ photos: PackerPhotoRow[] }> {
  const params = new URLSearchParams({ packerLogId: String(packerLogId) });
  const res = await fetch(`/api/packing-photos?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) return { photos: [] };
  return res.json();
}

export function useScopedPackerPhotos(packerLogId: number, opts?: { enabled?: boolean }) {
  const queryClient = useQueryClient();
  const queryKey = packerPhotosQueryKey(packerLogId);
  const enabled = opts?.enabled ?? (Number.isFinite(packerLogId) && packerLogId > 0);

  const query = useQuery<{ photos: PackerPhotoRow[] }>({
    queryKey,
    queryFn: () => fetchPackerPhotos(packerLogId),
    enabled,
    staleTime: 10_000,
  });

  const priorPhotos = useMemo<PriorPhoto[]>(
    () =>
      (query.data?.photos ?? [])
        .filter((p) => !!p.photoUrl?.trim())
        .map((p) => ({
          id: `prior-${p.id}`,
          photoId: p.id,
          previewUrl: p.photoUrl,
        })),
    [query.data?.photos],
  );

  const deletePrior = async (photoId: number): Promise<boolean> => {
    const res = await fetch(`/api/packing-photos?id=${photoId}`, { method: 'DELETE' });
    if (!res.ok) return false;
    await queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ['packer-photos', packerLogId] });
    queryClient.invalidateQueries({ queryKey: ['packer-logs-mobile'] });
    return true;
  };

  return { queryKey, priorPhotos, deletePrior, query };
}
