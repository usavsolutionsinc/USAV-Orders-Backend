'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import type {
  PhotoLibraryFilterState,
  PhotoLibraryViewMode,
} from '@/lib/photos/library-filter-state';

/**
 * Server-backed saved views for the Media Library (/ops/photos). Persistence only —
 * the active view is the URL (applying a view writes its filters/mode to the params
 * via usePhotoLibraryUrlState), so the "filters live in the URL" invariant holds.
 * Mirrors useOperationsSavedViews.
 */

/** The snapshot persisted in the `filters` JSONB bag. Versioned for forward compat. */
export interface MediaViewPayload {
  schemaVersion: 1;
  filters: PhotoLibraryFilterState;
  view: PhotoLibraryViewMode;
}

export interface MediaSavedView {
  id: number;
  name: string;
  filters: MediaViewPayload | Record<string, unknown>;
  is_shared: boolean;
  sort_order: number;
  staff_id: number;
  created_at: string;
  updated_at: string;
}

const QUERY_KEY = ['media-saved-views'] as const;

async function reqJson(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json;
}

/** Coerce a stored `filters` bag back into a payload (tolerant of legacy/no-version). */
export function readMediaViewPayload(view: MediaSavedView): MediaViewPayload {
  const bag = view.filters as Partial<MediaViewPayload> | undefined;
  return {
    schemaVersion: 1,
    filters: (bag?.filters as PhotoLibraryFilterState) ?? {},
    view: (bag?.view as PhotoLibraryViewMode) ?? 'folders',
  };
}

export function useMediaLibrarySavedViews() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const enabled = !!user?.staffId;

  const list = useQuery({
    queryKey: QUERY_KEY,
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<MediaSavedView[]> => {
      const res = await fetch('/api/photos/saved-views');
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json?.views) ? json.views : [];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: QUERY_KEY });

  const create = useMutation({
    mutationFn: (body: { name: string; filters: MediaViewPayload; isShared?: boolean }) =>
      reqJson('/api/photos/saved-views', 'POST', body),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({
      id,
      ...patch
    }: { id: number } & Partial<{ name: string; filters: MediaViewPayload; isShared: boolean }>) =>
      reqJson(`/api/photos/saved-views/${id}`, 'PATCH', patch),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: number) => reqJson(`/api/photos/saved-views/${id}`, 'DELETE'),
    onSuccess: invalidate,
  });

  return {
    views: list.data ?? [],
    isLoading: list.isLoading,
    create: create.mutate,
    creating: create.isPending,
    createError: create.error instanceof Error ? create.error.message : null,
    update: update.mutate,
    remove: remove.mutate,
    removing: remove.isPending,
  };
}
