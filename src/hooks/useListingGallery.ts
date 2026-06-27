'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface ListingGalleryPhoto {
  id: number;
  photoId: number;
  sortOrder: number;
  isCover: boolean;
  createdAt: string;
  displayUrl: string;
  thumbUrl: string;
}

export type ListingGalleryTarget = { kind: 'sku' | 'unit'; id: number };

interface GalleryResponse {
  items: ListingGalleryPhoto[];
}

function targetParams(target: ListingGalleryTarget): string {
  return `targetKind=${target.kind}&targetId=${target.id}`;
}

/**
 * The ordered marketplace gallery for a SKU or unit, with add/reorder/cover/
 * remove mutations. Each mutation returns the fresh ordered set, which we write
 * straight into the cache so the composer reflects the new order immediately.
 */
export function useListingGallery(target: ListingGalleryTarget | null) {
  const queryClient = useQueryClient();
  const queryKey = ['listing-gallery', target?.kind, target?.id];

  const query = useQuery<GalleryResponse>({
    queryKey,
    enabled: target != null,
    queryFn: async () => {
      const res = await fetch(`/api/photos/listing-gallery?${targetParams(target!)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load gallery');
      return res.json() as Promise<GalleryResponse>;
    },
  });

  const writeCache = (items: ListingGalleryPhoto[]) =>
    queryClient.setQueryData<GalleryResponse>(queryKey, { items });

  const addPhotos = useMutation({
    mutationFn: async (photoIds: number[]) => {
      const res = await fetch('/api/photos/listing-gallery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetKind: target!.kind, targetId: target!.id, photoIds }),
      });
      const data = (await res.json().catch(() => null)) as (GalleryResponse & { error?: string }) | null;
      if (!res.ok) throw new Error(data?.error || 'Failed to add photos');
      return data!.items;
    },
    onSuccess: writeCache,
  });

  const reorder = useMutation({
    mutationFn: async (orderedPhotoIds: number[]) => {
      const res = await fetch('/api/photos/listing-gallery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetKind: target!.kind, targetId: target!.id, orderedPhotoIds }),
      });
      const data = (await res.json().catch(() => null)) as (GalleryResponse & { error?: string }) | null;
      if (!res.ok) throw new Error(data?.error || 'Failed to reorder');
      return data!.items;
    },
    onSuccess: writeCache,
  });

  const setCover = useMutation({
    mutationFn: async (coverPhotoId: number) => {
      const res = await fetch('/api/photos/listing-gallery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetKind: target!.kind, targetId: target!.id, coverPhotoId }),
      });
      const data = (await res.json().catch(() => null)) as (GalleryResponse & { error?: string }) | null;
      if (!res.ok) throw new Error(data?.error || 'Failed to set cover');
      return data!.items;
    },
    onSuccess: writeCache,
  });

  const removePhoto = useMutation({
    mutationFn: async (photoId: number) => {
      const res = await fetch(
        `/api/photos/listing-gallery?${targetParams(target!)}&photoId=${photoId}`,
        { method: 'DELETE' },
      );
      const data = (await res.json().catch(() => null)) as (GalleryResponse & { error?: string }) | null;
      if (!res.ok) throw new Error(data?.error || 'Failed to remove photo');
      return data!.items;
    },
    onSuccess: writeCache,
  });

  return {
    items: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    addPhotos,
    reorder,
    setCover,
    removePhoto,
  };
}
