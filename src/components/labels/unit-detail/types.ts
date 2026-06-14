'use client';

import { useQuery } from '@tanstack/react-query';

// ─── Detail shapes (mirror GET /api/serial-units/[id]?include=full) ──────────

export interface UnitDetail {
  id: number;
  serial_number: string;
  normalized_serial: string;
  /** Minted products-label unit id ({SKU}-{YYWW}-{SEQ6}); what the label QR carries. */
  unit_uid: string | null;
  sku: string | null;
  sku_catalog_id: number | null;
  current_status: string;
  current_location: string | null;
  condition_grade: string | null;
  origin_source: string | null;
  origin_receiving_line_id: number | null;
  received_at: string | null;
  received_by: number | null;
  received_by_name: string | null;
  product_title: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimelineEvent {
  id: number;
  occurred_at: string;
  event_type: string;
  station: string | null;
  prev_status: string | null;
  next_status: string | null;
  bin_id: number | null;
  bin_name?: string | null;
  actor_staff_id: number | null;
  actor_name?: string | null;
  scan_token: string | null;
  notes: string | null;
  payload: Record<string, unknown> | null;
}

export interface Allocation {
  id: number;
  order_id: string;
  allocated_at: string;
  state: string;
  released_at: string | null;
  released_reason: string | null;
  allocated_by_name: string | null;
}

export interface ConditionRow {
  id: number;
  assessed_at: string;
  assessed_by_name: string | null;
  prev_grade: string | null;
  new_grade: string;
  cosmetic_notes: string | null;
  functional_notes: string | null;
}

export interface TsnLink {
  id: number;
  station_source: string | null;
  shipment_id: number | null;
  serial_type: string | null;
  fnsku: string | null;
  tested_by_name: string | null;
  created_at: string;
}

/** Full bin row resolved from the unit's denormalized `current_location`. */
export interface LocationDetail {
  id: number;
  name: string;
  room: string | null;
  zone_letter: string | null;
  bin_type: string | null;
  barcode: string | null;
}

/** SKU-level on-hand snapshot for the inventory-linkage popover. */
export interface StockSummary {
  stock: number;
  boxed_stock: number;
  product_title: string | null;
}

/** A photo captured against the unit (entity_type='SERIAL_UNIT'). */
export interface UnitPhoto {
  id: number;
  url: string;
  /** Capture stage: 'prepack' | 'shipout' (free-text photo_type). */
  photo_type: string | null;
  uploaded_by: number | null;
  created_at: string;
}

export interface UnitResponse {
  success: boolean;
  serial_unit: UnitDetail;
  events: TimelineEvent[];
  events_full?: TimelineEvent[];
  conditions?: ConditionRow[];
  allocations?: Allocation[];
  tsn_links?: TsnLink[];
  location_detail?: LocationDetail | null;
  stock?: StockSummary | null;
  photos?: UnitPhoto[];
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

/**
 * Full unit detail — events timeline, condition history, allocations, tsn
 * cross-refs, resolved bin (`location_detail`) and SKU stock snapshot
 * (`stock`). Keyed by `historyId` (numeric serial_units.id or serial_number).
 */
export function useSerialUnitDetail(historyId: string) {
  return useQuery<UnitResponse>({
    queryKey: ['serial-unit.detail', historyId],
    enabled: historyId.length > 0,
    queryFn: async () => {
      const res = await fetch(
        `/api/serial-units/${encodeURIComponent(historyId)}?include=full&orPrint=1`,
        { cache: 'no-store' },
      );
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      return json as UnitResponse;
    },
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}

export interface SimilarProduct {
  sku_id: number;
  sku: string;
  product_title: string | null;
  category: string | null;
  image_url: string | null;
  stock: number;
  boxed_stock: number;
}

export interface SimilarProductsResult {
  category: string | null;
  items: SimilarProduct[];
}

/** Same-category sibling SKUs — derived on demand from the catalog. */
export function useSimilarProducts(skuCatalogId: number | null | undefined) {
  return useQuery<SimilarProductsResult>({
    queryKey: ['sku.similar', skuCatalogId],
    enabled: typeof skuCatalogId === 'number' && skuCatalogId > 0,
    queryFn: async () => {
      const res = await fetch(`/api/sku-catalog/${skuCatalogId}/similar`);
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      return { category: json.category ?? null, items: json.items ?? [] };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
