'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export interface AssignParentArgs {
  childLogicalKey: string;
  childBase: string;
  parentItemId: string;
  qty?: number;
  notes?: string | null;
}

/** Pairing mutations for the parts graph. All invalidate the parts-graph query. */
export function usePartLinkMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['inventory', 'parts-graph'] });

  const assignParent = useMutation({
    mutationFn: (args: AssignParentArgs) => postJson('/api/inventory/parts/links', args),
    onSuccess: invalidate,
  });

  const markNotAPart = useMutation({
    mutationFn: (args: { childLogicalKey: string; childBase: string }) =>
      postJson('/api/inventory/parts/links/not-a-part', args),
    onSuccess: invalidate,
  });

  const removeLink = useMutation({
    mutationFn: async (linkId: number) => {
      const res = await fetch(`/api/inventory/parts/links/${linkId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Failed to remove link');
      return true;
    },
    onSuccess: invalidate,
  });

  return { assignParent, markNotAPart, removeLink };
}
