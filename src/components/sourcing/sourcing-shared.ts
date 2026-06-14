'use client';

/**
 * Shared helpers for the dashboard Sourcing hub (Queue / Scout / Watchlist).
 * Mode is URL-driven (?mode=) so the sidebar and the right pane stay in sync.
 *
 * Hub IA (sourcing-hub-integration-plan.md §7):
 *   - Queue  (default, bare URL) — the prioritized demand list (alerts ++).
 *   - Scout  (?mode=scout)       — resolve a product/model → compatible parts → scour.
 *   - Watchlist (?mode=watchlist) — saved candidates across channels.
 * Legacy keys (`alerts` → queue, `lookup` → scout) are aliased so old links work.
 */

import { Search, AlertCircle, Star, Clock, Link2 } from '@/components/Icons';
import type { HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';

export type SourcingMode = 'queue' | 'scout' | 'watchlist' | 'searches' | 'suppliers';

export function resolveSourcingMode(raw: string | null): SourcingMode {
  if (raw === 'scout' || raw === 'lookup') return 'scout';
  if (raw === 'watchlist') return 'watchlist';
  if (raw === 'searches') return 'searches';
  if (raw === 'suppliers') return 'suppliers';
  return 'queue'; // default; legacy 'alerts' lands here too
}

/** Mode rail items (used by the sidebar slider when the master-nav rail is off). */
export const SOURCING_MODE_ITEMS: HorizontalSliderItem[] = [
  { id: 'queue', label: 'Queue', icon: AlertCircle },
  { id: 'scout', label: 'Scout', icon: Search },
  { id: 'watchlist', label: 'Watchlist', icon: Star },
  { id: 'searches', label: 'Searches', icon: Clock },
  { id: 'suppliers', label: 'Suppliers', icon: Link2 },
];

/** Supplier type → short label (matches the suppliers table vocab). */
export const SUPPLIER_TYPE_LABEL: Record<string, string> = {
  ebay_seller: 'eBay seller',
  distributor: 'Distributor',
  salvage: 'Salvage',
  oem: 'OEM',
  marketplace: 'Marketplace',
  other: 'Other',
};

/** Cadence label + tone for standing searches. */
export const CADENCE_LABEL: Record<string, string> = {
  off: 'Manual',
  daily: 'Daily',
  weekly: 'Weekly',
};

export const cadenceTone: Record<string, string> = {
  daily: 'bg-emerald-50 text-emerald-700',
  weekly: 'bg-blue-50 text-blue-700',
  off: 'bg-slate-100 text-slate-500',
};

export async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}

export function formatCents(cents: number | null | undefined, currency = 'USD'): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export const conditionTone: Record<string, string> = {
  new: 'bg-emerald-50 text-emerald-700',
  refurbished: 'bg-blue-50 text-blue-700',
  used: 'bg-amber-50 text-amber-700',
  for_parts: 'bg-red-50 text-red-700',
};

export const severityTone: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 ring-red-200',
  warn: 'bg-amber-50 text-amber-700 ring-amber-200',
  info: 'bg-slate-50 text-slate-600 ring-slate-200',
};

export const ALERT_TYPE_LABEL: Record<string, string> = {
  eol: 'End of life',
  discontinued: 'Discontinued',
  low_stock: 'Low stock',
  demand_no_stock: 'Demand · no stock',
  replenish: 'Replenish',
  missing_part: 'Missing part',
  repair_part: 'Repair part',
  warranty_part: 'Warranty part',
  fba_replenish: 'FBA replenish',
  manual: 'Manual',
};

/** Where a queue row's demand came from (chip on each Queue row). */
export const DEMAND_SOURCE_LABEL: Record<string, string> = {
  scan: 'Scan',
  replenish: 'Sold',
  missing_part: 'Missing part',
  repair: 'Repair',
  warranty: 'Warranty',
  order_exception: 'Order',
  pending_sku: 'Pending SKU',
  fba: 'FBA',
  manual: 'Manual',
};

export const demandSourceTone: Record<string, string> = {
  manual: 'bg-violet-50 text-violet-700',
  replenish: 'bg-indigo-50 text-indigo-700',
  repair: 'bg-orange-50 text-orange-700',
  warranty: 'bg-rose-50 text-rose-700',
  missing_part: 'bg-amber-50 text-amber-700',
  fba: 'bg-orange-50 text-orange-700',
  scan: 'bg-slate-100 text-slate-600',
};
