'use client';

/**
 * Client-side fetchers for the Warranty Claim Logger read API. Thin wrappers
 * around the GET routes; consumed by the React Query factories in
 * dashboard-queries.ts and the warranty hooks.
 */

import type {
  WarrantyClaimDetail,
  WarrantyClaimListRow,
  WarrantyClaimStatus,
  WarrantyCoverageResult,
} from './types';

export interface FetchWarrantyClaimsParams {
  status?: WarrantyClaimStatus | null;
  search?: string | null;
  expiringWithinDays?: number | null;
  provisionalOnly?: boolean;
}

function buildQuery(params: FetchWarrantyClaimsParams): string {
  const sp = new URLSearchParams();
  if (params.status) sp.set('status', params.status);
  if (params.search) sp.set('search', params.search);
  if (typeof params.expiringWithinDays === 'number') {
    sp.set('expiringWithinDays', String(params.expiringWithinDays));
  }
  if (params.provisionalOnly) sp.set('provisionalOnly', '1');
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

export async function fetchWarrantyClaims(
  params: FetchWarrantyClaimsParams = {},
): Promise<WarrantyClaimListRow[]> {
  const res = await fetch(`/api/warranty/claims${buildQuery(params)}`, {
    headers: { Accept: 'application/json' },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `warranty claims request failed (${res.status})`);
  }
  return (json.claims ?? []) as WarrantyClaimListRow[];
}

export async function fetchWarrantyClaim(id: number): Promise<WarrantyClaimDetail | null> {
  const res = await fetch(`/api/warranty/claims/${id}`, {
    headers: { Accept: 'application/json' },
  });
  if (res.status === 404) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `warranty claim request failed (${res.status})`);
  }
  return (json.claim ?? null) as WarrantyClaimDetail | null;
}

/** Read-only warranty-coverage lookup (order #, serial, or SKU). */
export async function fetchWarrantyCoverage(q: string): Promise<WarrantyCoverageResult | null> {
  const trimmed = q.trim();
  if (!trimmed) return null;
  const res = await fetch(`/api/warranty/lookup?q=${encodeURIComponent(trimmed)}`, {
    headers: { Accept: 'application/json' },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `warranty coverage request failed (${res.status})`);
  }
  return (json.coverage ?? null) as WarrantyCoverageResult | null;
}
