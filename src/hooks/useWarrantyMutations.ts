'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WarrantyClaimDetail } from '@/lib/warranty/types';

async function postJson(url: string, body: unknown): Promise<{ claim: WarrantyClaimDetail }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) throw new Error(json?.error || `request failed (${res.status})`);
  return json;
}

async function patchJson(url: string, body: unknown): Promise<{ claim: WarrantyClaimDetail }> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) throw new Error(json?.error || `request failed (${res.status})`);
  return json;
}

/** For responses that aren't shaped `{ claim }` (quotes, ebay draft). */
async function sendRaw(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) throw new Error(json?.error || `request failed (${res.status})`);
  return json;
}

/** Shared cache invalidation after any claim write. */
function useInvalidateClaims() {
  const qc = useQueryClient();
  return (claimId?: number) => {
    qc.invalidateQueries({ queryKey: ['warranty-claims'] });
    if (claimId) qc.invalidateQueries({ queryKey: ['warranty-claim', claimId] });
  };
}

export type WarrantyLifecycleAction = 'submit' | 'approve' | 'close';

export function useWarrantyMutations() {
  const invalidate = useInvalidateClaims();

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => postJson('/api/warranty/claims', body),
    onSuccess: (data) => invalidate(data.claim?.id),
  });

  const lifecycle = useMutation({
    mutationFn: ({ id, action }: { id: number; action: WarrantyLifecycleAction }) =>
      postJson(`/api/warranty/claims/${id}/${action}`, {}),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });

  const deny = useMutation({
    mutationFn: ({ id, reasonCode, denialNotes }: { id: number; reasonCode: string; denialNotes?: string }) =>
      postJson(`/api/warranty/claims/${id}/deny`, { reasonCode, denialNotes }),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });

  const logRepair = useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      postJson(`/api/warranty/claims/${id}/repair`, body),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      patchJson(`/api/warranty/claims/${id}`, body),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });

  const issueRma = useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      postJson(`/api/warranty/claims/${id}/rma`, body),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });

  const repairHandoff = useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      postJson(`/api/warranty/claims/${id}/repair-handoff`, body),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });

  const createQuote = useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      sendRaw(`/api/warranty/claims/${id}/quote`, 'POST', body),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });

  const quoteStatus = useMutation({
    mutationFn: ({ quoteId, status }: { quoteId: number; claimId: number; status: string }) =>
      sendRaw(`/api/warranty/quotes/${quoteId}`, 'PATCH', { status }),
    onSuccess: (_data, vars) => invalidate(vars.claimId),
  });

  const ebayDraft = useMutation({
    mutationFn: ({ id }: { id: number }) => sendRaw(`/api/warranty/claims/${id}/ebay-draft`, 'POST', {}),
  });

  return { create, lifecycle, deny, logRepair, update, issueRma, repairHandoff, createQuote, quoteStatus, ebayDraft };
}

export interface DenialReason {
  code: string;
  label: string;
}

/** Warranty denial reasons (reason_codes category=warranty_denial). */
export function useWarrantyDenialReasons() {
  return useQuery({
    queryKey: ['warranty-denial-reasons'],
    queryFn: async (): Promise<DenialReason[]> => {
      const res = await fetch('/api/reason-codes?category=warranty_denial&direction=out');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return [];
      const list = (json?.reasonCodes || json?.reason_codes || json?.codes || []) as Array<{
        code: string;
        label: string;
      }>;
      return list.map((r) => ({ code: r.code, label: r.label }));
    },
    staleTime: 5 * 60 * 1000,
  });
}
