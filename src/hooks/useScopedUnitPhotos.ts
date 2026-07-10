'use client';

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { PriorPhoto } from '@/components/mobile/station/MobilePackerSpamCamera';
import { normalizePhotoDisplayUrl } from '@/lib/nas-photo-url';

/**
 * Committed SERIAL_UNIT testing-scan photos for one unit — the unit-scoped twin
 * of `useScopedReceivingPhotos`. Reads `GET /api/serial-units/{id}/photos`
 * (returns every SERIAL_UNIT photo for the unit) and deletes via the shared
 * `DELETE /api/photos/{id}`. Keyed `['unit-photos', serialUnitId]` so the
 * realtime refresh + the mobile capture surface invalidate the same cache.
 */

export interface UnitPhotoRow {
  id: number;
  url: string;
  photoType: string | null;
  uploadedBy: number | null;
  createdAt: string;
}

export function unitPhotosQueryKey(serialUnitId: number) {
  return ['unit-photos', serialUnitId] as const;
}

async function fetchUnitPhotos(serialUnitId: number): Promise<{ photos: UnitPhotoRow[] }> {
  const res = await fetch(`/api/serial-units/${serialUnitId}/photos`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return { photos: Array.isArray(body?.photos) ? body.photos : [] };
}

function toPriorPhotos(rows: UnitPhotoRow[]): PriorPhoto[] {
  return rows
    .filter((p) => !!p.url?.trim())
    .map((p) => ({
      id: `prior-${p.id}`,
      photoId: p.id,
      previewUrl: normalizePhotoDisplayUrl(p.url),
    }));
}

export interface UseScopedUnitPhotosResult {
  queryKey: ReturnType<typeof unitPhotosQueryKey>;
  photos: UnitPhotoRow[];
  priorPhotos: PriorPhoto[];
  deletePhoto: (photoId: number) => Promise<boolean>;
  query: UseQueryResult<{ photos: UnitPhotoRow[] }, Error>;
}

export function useScopedUnitPhotos(serialUnitId: number): UseScopedUnitPhotosResult {
  const queryClient = useQueryClient();
  const queryKey = unitPhotosQueryKey(serialUnitId);
  const query = useQuery({
    queryKey,
    queryFn: () => fetchUnitPhotos(serialUnitId),
    enabled: Number.isFinite(serialUnitId) && serialUnitId > 0,
    staleTime: 15_000,
  });

  const photos = query.data?.photos ?? [];

  const deletePhoto = async (photoId: number): Promise<boolean> => {
    try {
      const res = await fetch(`/api/photos/${photoId}`, { method: 'DELETE' });
      if (!res.ok) return false;
      await queryClient.invalidateQueries({ queryKey });
      return true;
    } catch {
      return false;
    }
  };

  return { queryKey, photos, priorPhotos: toPriorPhotos(photos), deletePhoto, query };
}
