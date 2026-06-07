'use client';

/**
 * Shared helpers for the dashboard Sourcing page (Lookup / Alerts / Watchlist).
 * Mode is URL-driven (?mode=) so the sidebar and the right pane stay in sync.
 */

import { Search, AlertCircle, Star } from '@/components/Icons';
import type { HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';

export type SourcingMode = 'lookup' | 'alerts' | 'watchlist';

export function resolveSourcingMode(raw: string | null): SourcingMode {
  return raw === 'alerts' || raw === 'watchlist' ? raw : 'lookup';
}

/** Mode rail items (used by the sidebar slider when the master-nav rail is off). */
export const SOURCING_MODE_ITEMS: HorizontalSliderItem[] = [
  { id: 'lookup', label: 'Lookup', icon: Search },
  { id: 'alerts', label: 'Alerts', icon: AlertCircle },
  { id: 'watchlist', label: 'Watchlist', icon: Star },
];

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
};
