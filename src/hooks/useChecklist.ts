'use client';

import { useQuery } from '@tanstack/react-query';
import type { ChecklistScopeType, ChecklistTemplateRow } from '@/lib/neon/checklist-queries';

export interface ChecklistResult {
  items: ChecklistTemplateRow[];
}

/** React-query key for a checklist scope — shared by the hook and mutators. */
export function checklistQueryKey(scopeType: ChecklistScopeType, scopeId?: number | null) {
  return ['checklist', scopeType, scopeId ?? null] as const;
}

/**
 * Fetches a scope's checklist steps from /api/checklists. Defaults to the
 * org-wide GLOBAL list (the receiving Checklist tab). `publishedOnly` keeps the
 * fill view free of draft steps; pass false from an authoring surface.
 */
export function useChecklist(
  scopeType: ChecklistScopeType = 'GLOBAL',
  scopeId?: number | null,
  opts?: { publishedOnly?: boolean; enabled?: boolean },
) {
  const publishedOnly = opts?.publishedOnly !== false;
  return useQuery<ChecklistResult>({
    queryKey: checklistQueryKey(scopeType, scopeId),
    enabled: opts?.enabled ?? true,
    queryFn: async () => {
      const params = new URLSearchParams({ scopeType });
      if (publishedOnly) params.set('publishedOnly', '1');
      if (scopeId != null) params.set('scopeId', String(scopeId));
      const res = await fetch(`/api/checklists?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load checklist');
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || 'Failed to load checklist');
      return { items: Array.isArray(data.items) ? data.items : [] };
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
