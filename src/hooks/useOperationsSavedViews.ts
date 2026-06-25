'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import type { JourneyUrlFilters } from '@/components/sidebar/operations/useOperationsTimelineUrlState';

/**
 * Server-backed saved views for the Master Operations Journey. Persistence only —
 * the active view is the URL (applying a view writes its filters to the params via
 * the URL-state hook), so the Monitor "filters live in the URL" invariant holds.
 */

export interface OperationsSavedView {
  id: number;
  name: string;
  filters: Partial<JourneyUrlFilters>;
  is_shared: boolean;
  sort_order: number;
  staff_id: number;
  created_at: string;
  updated_at: string;
}

const QUERY_KEY = ['operations-saved-views'] as const;

async function postJson(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json;
}

export function useOperationsSavedViews() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const enabled = !!user?.staffId;

  const list = useQuery({
    queryKey: QUERY_KEY,
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<OperationsSavedView[]> => {
      const res = await fetch('/api/operations/saved-views');
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json?.views) ? json.views : [];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: QUERY_KEY });

  const create = useMutation({
    mutationFn: (body: { name: string; filters: Partial<JourneyUrlFilters>; isShared?: boolean }) =>
      postJson('/api/operations/saved-views', 'POST', body),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, ...patch }: { id: number } & Partial<Pick<OperationsSavedView, 'name' | 'is_shared'>> & { filters?: Partial<JourneyUrlFilters>; isShared?: boolean }) =>
      postJson(`/api/operations/saved-views/${id}`, 'PATCH', patch),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: number) => postJson(`/api/operations/saved-views/${id}`, 'DELETE'),
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
