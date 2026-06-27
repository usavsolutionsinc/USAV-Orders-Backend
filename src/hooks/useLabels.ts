'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PhotoLabel } from '@/lib/photos/labels';

interface LabelsResponse {
  labels: PhotoLabel[];
}

const QUERY_KEY = ['photo-labels'];

/**
 * The org's photo-label vocabulary + CRUD/assignment mutations. The vocabulary
 * is cached (5 min) and shared by the sidebar Labels section and the per-photo
 * editor. Assignment mutations invalidate the photo-library list so chips
 * re-render with the new set.
 *
 * `scopeImageType` narrows the vocabulary to a type's labels + globals (used by
 * the listing composer); omit it for the full library list.
 */
export function useLabels(scopeImageType?: string) {
  const queryClient = useQueryClient();
  const queryKey = scopeImageType ? [...QUERY_KEY, scopeImageType] : QUERY_KEY;

  const query = useQuery<LabelsResponse>({
    queryKey,
    queryFn: async () => {
      const qs = scopeImageType ? `?scopeImageType=${encodeURIComponent(scopeImageType)}` : '';
      const res = await fetch(`/api/photos/labels${qs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load labels');
      return res.json() as Promise<LabelsResponse>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const invalidateVocab = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  const invalidateLibrary = () => queryClient.invalidateQueries({ queryKey: ['photo-library'] });

  const createLabel = useMutation({
    mutationFn: async (input: { label: string; color?: string; icon?: string; scopeImageType?: string }) => {
      const res = await fetch('/api/photos/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = (await res.json().catch(() => null)) as { label?: PhotoLabel; error?: string } | null;
      if (!res.ok) throw new Error(data?.error || 'Failed to create label');
      return data!.label!;
    },
    onSuccess: invalidateVocab,
  });

  const updateLabel = useMutation({
    mutationFn: async (input: { id: number; label?: string; color?: string; icon?: string | null }) => {
      const { id, ...patch } = input;
      const res = await fetch(`/api/photos/labels/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = (await res.json().catch(() => null)) as { label?: PhotoLabel; error?: string } | null;
      if (!res.ok) throw new Error(data?.error || 'Failed to update label');
      return data!.label!;
    },
    onSuccess: () => {
      invalidateVocab();
      invalidateLibrary();
    },
  });

  const deleteLabel = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/photos/labels/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || 'Failed to delete label');
      }
      return id;
    },
    onSuccess: () => {
      invalidateVocab();
      invalidateLibrary();
    },
  });

  /** Replace a single photo's label set (PUT semantics). */
  const setPhotoLabels = useMutation({
    mutationFn: async (input: { photoId: number; labelIds: number[] }) => {
      const res = await fetch(`/api/photos/${input.photoId}/labels`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labelIds: input.labelIds }),
      });
      const data = (await res.json().catch(() => null)) as { labels?: PhotoLabel[]; error?: string } | null;
      if (!res.ok) throw new Error(data?.error || 'Failed to set labels');
      return data!.labels ?? [];
    },
    onSuccess: invalidateLibrary,
  });

  /** Add/remove labels across many selected photos (selection toolbar). */
  const bulkApply = useMutation({
    mutationFn: async (input: { photoIds: number[]; addLabelIds?: number[]; removeLabelIds?: number[] }) => {
      const res = await fetch('/api/photos/labels/bulk-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = (await res.json().catch(() => null)) as { photos?: number; error?: string } | null;
      if (!res.ok) throw new Error(data?.error || 'Failed to apply labels');
      return data!.photos ?? 0;
    },
    onSuccess: invalidateLibrary,
  });

  return {
    labels: query.data?.labels ?? [],
    isLoading: query.isLoading,
    createLabel,
    updateLabel,
    deleteLabel,
    setPhotoLabels,
    bulkApply,
  };
}
