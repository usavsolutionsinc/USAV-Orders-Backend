'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { PriorPhoto } from '@/components/mobile/station/MobilePackerSpamCamera';
import type { PhotoScope } from '@/components/mobile/receiving/PhotoUploadQueue';
import { normalizePhotoDisplayUrl } from '@/lib/nas-photo-url';
import { deleteNasPhoto, isNasPhotoUrl } from '@/lib/nas-photos';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';

export interface ReceivingPhotoRow {
  id: number;
  receivingId: number;
  receivingLineId: number | null;
  photoUrl: string;
  createdAt: string;
}

export interface ScopedReceivingPhoto {
  id: number;
  receivingId: number;
  receivingLineId: number | null;
  photoUrl: string;
  createdAt: string;
  displayUrl: string;
}

/** Canonical React Query key for a receiving photo scope (PO vs line). */
export function receivingPhotosQueryKey(scope: PhotoScope) {
  return ['receiving-photos', scope.receivingId, scope.receivingLineId ?? 'po'] as const;
}

async function fetchReceivingPhotos(scope: PhotoScope): Promise<{ photos: ReceivingPhotoRow[] }> {
  const params = new URLSearchParams({ receivingId: String(scope.receivingId) });
  if (scope.receivingLineId != null) {
    params.set('receivingLineId', String(scope.receivingLineId));
  } else {
    params.set('scope', 'po');
  }
  const res = await fetch(`/api/receiving-photos?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function toDisplayPhotos(rows: ReceivingPhotoRow[]): ScopedReceivingPhoto[] {
  return rows
    .filter((p) => !!p.photoUrl?.trim())
    .map((p) => ({
      ...p,
      displayUrl: normalizePhotoDisplayUrl(p.photoUrl),
    }));
}

function toPriorPhotos(rows: ReceivingPhotoRow[]): PriorPhoto[] {
  return rows
    .filter((p) => !!p.photoUrl?.trim())
    .map((p) => ({
      id: `prior-${p.id}`,
      photoId: p.id,
      previewUrl: normalizePhotoDisplayUrl(p.photoUrl),
    }));
}

export interface UseScopedReceivingPhotosResult {
  queryKey: ReturnType<typeof receivingPhotosQueryKey>;
  photos: ScopedReceivingPhoto[];
  priorPhotos: PriorPhoto[];
  deletePhoto: (photoId: number) => Promise<boolean>;
  query: UseQueryResult<{ photos: ReceivingPhotoRow[] }, Error>;
}

/**
 * Single source of truth for committed receiving photos in a scope.
 * Used by the photo studio, carton strip, and capture prior-photo bubble.
 */
export function useScopedReceivingPhotos(
  scope: PhotoScope,
  opts?: { enabled?: boolean },
): UseScopedReceivingPhotosResult {
  const queryClient = useQueryClient();
  const queryKey = receivingPhotosQueryKey(scope);
  const enabled = opts?.enabled ?? (Number.isFinite(scope.receivingId) && scope.receivingId > 0);

  const query = useQuery<{ photos: ReceivingPhotoRow[] }>({
    queryKey,
    queryFn: () => fetchReceivingPhotos(scope),
    enabled,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });

  const photos = useMemo(
    () => toDisplayPhotos(query.data?.photos ?? []),
    [query.data?.photos],
  );

  const priorPhotos = useMemo(
    () => toPriorPhotos(query.data?.photos ?? []),
    [query.data?.photos],
  );

  const deletePhoto = async (photoId: number): Promise<boolean> => {
    const row = query.data?.photos?.find((p) => p.id === photoId);
    const displayUrl = row ? normalizePhotoDisplayUrl(row.photoUrl) : '';
    if (displayUrl && isNasPhotoUrl(displayUrl)) {
      const nasDel = await deleteNasPhoto(displayUrl);
      if (!nasDel.ok) console.warn('NAS file delete failed:', nasDel.error);
    }
    const res = await fetch(`/api/photos/${photoId}`, { method: 'DELETE' });
    if (!res.ok) return false;
    await queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ['receiving-photos', scope.receivingId] });
    invalidateReceivingFeeds(queryClient);
    return true;
  };

  return { queryKey, photos, priorPhotos, deletePhoto, query };
}
