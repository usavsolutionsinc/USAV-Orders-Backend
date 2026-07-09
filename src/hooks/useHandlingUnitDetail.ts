'use client';

import { useQuery } from '@tanstack/react-query';

/** One member unit of a box, as returned by GET /api/handling-units/[id]. */
export interface HandlingUnitMemberView {
  id: number;
  serial_number: string;
  unit_uid: string | null;
  sku: string | null;
  sku_catalog_id?: number | null;
  current_status: string;
  current_location: string | null;
  condition_grade: string | null;
  origin_receiving_line_id: number | null;
}

/** Box detail payload (the `handling_unit` field of the GET response). */
export interface HandlingUnitDetailView {
  id: number;
  code: string;
  status: string;
  location_name: string | null;
  notes: string | null;
  units: HandlingUnitMemberView[];
  receiving_line_ids: number[];
  rollup: { total: number; tested: number; untested: number };
}

interface BoxResponse {
  success: boolean;
  handling_unit: HandlingUnitDetailView;
}

export function handlingUnitDetailQueryKey(idOrCode: string | number) {
  return ['handling-unit.detail', String(idOrCode)] as const;
}

/**
 * Shared box (handling-unit) detail fetch — `GET /api/handling-units/{idOrCode}`.
 * Accepts a numeric id, an `H-{id}` handle, or an external tote code. Powers the
 * desktop {@link BoxWorkbenchPanel}; mirrors the mobile box page's fetch so both
 * read the same endpoint + response shape (one query key family, cache-shared).
 */
export function useHandlingUnitDetail(idOrCode: string | number | null) {
  const key = idOrCode == null ? '' : String(idOrCode);
  return useQuery<BoxResponse>({
    queryKey: handlingUnitDetailQueryKey(key),
    enabled: key.length > 0,
    queryFn: async () => {
      const res = await fetch(`/api/handling-units/${encodeURIComponent(key)}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || `HTTP ${res.status}`);
      return json as BoxResponse;
    },
    refetchOnWindowFocus: false,
  });
}
