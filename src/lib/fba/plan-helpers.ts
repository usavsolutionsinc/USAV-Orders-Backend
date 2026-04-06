import { normalizeFnsku } from '@/lib/tracking-format';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ValidatedFnskuRow {
  fnsku: string;
  found: boolean;
  catalog_exists?: boolean;
  needs_details?: boolean;
  upserted_stub?: boolean;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
}

export interface BulkScanCandidate {
  fnsku: string;
  qty: number;
  found: boolean;
  catalog_exists?: boolean;
  needs_details?: boolean;
  upserted_stub?: boolean;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
}

export interface PlanPreviewLine {
  itemId: number;
  shipmentId: number;
  displayTitle: string;
  fnsku: string;
  expectedQty: number;
}

export type TodayItemSnapshot = { id: number; expected_qty: number; display_title: string };

export const PLAN_QTY_MAX = 9999;

// ─── Pure data transformers ─────────────────────────────────────────────────

/** Build fnsku → expected_qty from GET /api/fba/shipments/today */
export function todayShipmentQtyByFnskuFromJson(data: unknown): Record<string, number> {
  const map: Record<string, number> = {};
  const items = (data as { shipment?: { items?: { fnsku?: string; expected_qty?: number }[] } })?.shipment?.items;
  if (!Array.isArray(items)) return map;
  for (const i of items) {
    const f = normalizeFnsku(String(i?.fnsku || ''));
    if (f) map[f] = Math.max(0, Number(i?.expected_qty) || 0);
  }
  return map;
}

/** Shipment + per-FNSKU item ids from GET /api/fba/shipments/today (for PATCH vs POST). */
export function todayShipmentSnapshotFromJson(data: unknown): {
  shipmentId: number | null;
  shipmentRef: string;
  itemByFnsku: Record<string, TodayItemSnapshot>;
} {
  const shipment = (data as {
    shipment?: {
      id?: number;
      shipment_ref?: string;
      items?: { id?: number; fnsku?: string; expected_qty?: number; display_title?: string }[];
    } | null;
  })?.shipment;
  if (!shipment?.id) {
    return { shipmentId: null, shipmentRef: '', itemByFnsku: {} };
  }
  const itemByFnsku: Record<string, TodayItemSnapshot> = {};
  for (const it of shipment.items || []) {
    const f = normalizeFnsku(String(it?.fnsku || ''));
    if (!f) continue;
    itemByFnsku[f] = {
      id: Number(it.id),
      expected_qty: Math.max(0, Number(it?.expected_qty) || 0),
      display_title: String(it.display_title || f).trim() || f,
    };
  }
  return {
    shipmentId: Number(shipment.id),
    shipmentRef: String(shipment.shipment_ref || ''),
    itemByFnsku,
  };
}

/** Merge into pending review. Repeat scan: if already on today's plan and catalog-found (`row.found`), do not add qty (edit via stepper). Paste (`!row.found`) still sums. New row: today's line qty if on plan; else catalog-found start at 0; unknown / paste ≥1. */
export function mergeIntoPendingToday(
  prev: BulkScanCandidate[] | null,
  incoming: BulkScanCandidate | BulkScanCandidate[],
  todayQtyByFnsku: Record<string, number>,
): BulkScanCandidate[] {
  const list = prev ? [...prev] : [];
  const batch = Array.isArray(incoming) ? incoming : [incoming];
  for (const row of batch) {
    const idx = list.findIndex((r) => r.fnsku === row.fnsku);
    if (idx >= 0) {
      if (row.qty <= 0) continue;
      const onTodayPlan = (todayQtyByFnsku[row.fnsku] ?? 0) > 0;
      const delta = onTodayPlan && row.found ? 0 : row.qty;
      list[idx] = {
        ...list[idx],
        qty: Math.min(PLAN_QTY_MAX, list[idx].qty + delta),
        product_title: row.product_title ?? list[idx].product_title,
        asin: row.asin ?? list[idx].asin,
        sku: row.sku ?? list[idx].sku,
        found: list[idx].found && row.found,
      };
    } else {
      const t = todayQtyByFnsku[row.fnsku];
      let qty: number;
      if (t != null && t > 0) {
        qty = Math.min(PLAN_QTY_MAX, t);
      } else if (row.found) {
        qty = Math.min(PLAN_QTY_MAX, Math.max(0, row.qty));
      } else {
        qty = Math.min(PLAN_QTY_MAX, Math.max(1, row.qty));
      }
      if (!row.found && qty < 1) continue;
      list.push({ ...row, qty });
    }
  }
  return list;
}

/** Extract FNSKU-like codes (X0... or B0...) and their counts from a raw paste/input string. */
export function extractFnskuCounts(raw: string): Map<string, number> {
  const normalized = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const matches = normalized.match(/(?:X0|B0)[A-Z0-9]{8}/g) ?? [];
  const counts = new Map<string, number>();
  for (const match of matches) {
    counts.set(match, (counts.get(match) || 0) + 1);
  }
  return counts;
}
