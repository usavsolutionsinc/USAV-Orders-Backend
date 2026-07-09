'use client';

import { useQuery } from '@tanstack/react-query';

/** One member unit of a manifest, from GET /api/label-manifests/[id]. */
export interface ManifestItemView {
  serial_unit_id: number;
  serial_number: string;
  unit_uid: string | null;
  sku: string | null;
  current_status: string;
  condition_grade: string | null;
  origin_receiving_line_id: number | null;
  ordinal: number;
}

export interface ManifestDetailView {
  id: number;
  manifest_uid: string;
  manifest_type: 'PREBOX' | 'KIT' | 'MASTER_CARTON';
  sku: string | null;
  sku_catalog_id: number | null;
  condition_grade: string | null;
  status: 'OPEN' | 'SEALED' | 'DISSOLVED';
  notes: string | null;
  created_at: string;
  sealed_at: string | null;
  items: ManifestItemView[];
}

interface ManifestResponse {
  ok: boolean;
  manifest: ManifestDetailView;
}

export function manifestDetailQueryKey(ref: string | number) {
  return ['manifest.detail', String(ref)] as const;
}

/**
 * Shared manifest detail fetch — `GET /api/label-manifests/{ref}`. Accepts a
 * numeric id or a `KIT-…` manifest_uid (a scanned master label). Powers the
 * desktop ManifestWorkbenchPanel.
 */
export function useManifestDetail(ref: string | number | null) {
  const key = ref == null ? '' : String(ref);
  return useQuery<ManifestResponse>({
    queryKey: manifestDetailQueryKey(key),
    enabled: key.length > 0,
    queryFn: async () => {
      const res = await fetch(`/api/label-manifests/${encodeURIComponent(key)}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      return json as ManifestResponse;
    },
    refetchOnWindowFocus: false,
  });
}
