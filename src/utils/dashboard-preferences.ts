export type PendingStockFilterPreference = 'all' | 'pending' | 'stock';
export type ShippedTypeFilterPreference = 'all' | 'orders' | 'sku' | 'fba';
export type ShippedSearchFieldPreference =
  | 'all'
  | 'order_id'
  | 'tracking'
  | 'product_title'
  | 'sku'
  | 'serial_number';
export type DetailsOpenBehaviorPreference = 'auto' | 'side_panel';

const PREF_PENDING_FILTER = 'dashboard:pending-filter';
const PREF_SHIPPED_FILTER = 'dashboard:shipped-filter';
const PREF_SHIPPED_SEARCH_FIELD = 'dashboard:shipped-search-field';
const PREF_SHIPPED_WEEK_OFFSET = 'dashboard:shipped-week-offset';
const PREF_DETAILS_OPEN_BEHAVIOR = 'dashboard:details-open-behavior';

function canUseStorage() {
  return typeof window !== 'undefined' && !!window.localStorage;
}

export function readPendingFilterPreference(): PendingStockFilterPreference | null {
  if (!canUseStorage()) return null;
  const raw = String(window.localStorage.getItem(PREF_PENDING_FILTER) || '').trim();
  if (raw === 'pending' || raw === 'stock' || raw === 'all') return raw;
  return null;
}

export function writePendingFilterPreference(value: PendingStockFilterPreference): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(PREF_PENDING_FILTER, value);
}

export function readShippedFilterPreference(): ShippedTypeFilterPreference | null {
  if (!canUseStorage()) return null;
  const raw = String(window.localStorage.getItem(PREF_SHIPPED_FILTER) || '').trim();
  if (raw === 'orders' || raw === 'sku' || raw === 'fba' || raw === 'all') return raw;
  return null;
}

export function writeShippedFilterPreference(value: ShippedTypeFilterPreference): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(PREF_SHIPPED_FILTER, value);
}

export function readShippedSearchFieldPreference(): ShippedSearchFieldPreference | null {
  if (!canUseStorage()) return null;
  const raw = String(window.localStorage.getItem(PREF_SHIPPED_SEARCH_FIELD) || '').trim();
  if (
    raw === 'all'
    || raw === 'order_id'
    || raw === 'tracking'
    || raw === 'product_title'
    || raw === 'sku'
    || raw === 'serial_number'
  ) return raw;
  return null;
}

export function writeShippedSearchFieldPreference(value: ShippedSearchFieldPreference): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(PREF_SHIPPED_SEARCH_FIELD, value);
}

export function readShippedWeekOffsetPreference(): number | null {
  if (!canUseStorage()) return null;
  const raw = String(window.localStorage.getItem(PREF_SHIPPED_WEEK_OFFSET) || '').trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function writeShippedWeekOffsetPreference(value: number): void {
  if (!canUseStorage()) return;
  const normalized = Math.max(0, Number(value) || 0);
  window.localStorage.setItem(PREF_SHIPPED_WEEK_OFFSET, String(normalized));
}

export function readDetailsOpenBehaviorPreference(): DetailsOpenBehaviorPreference {
  if (!canUseStorage()) return 'auto';
  const raw = String(window.localStorage.getItem(PREF_DETAILS_OPEN_BEHAVIOR) || '').trim();
  if (raw === 'side_panel') return 'side_panel';
  return 'auto';
}

export function writeDetailsOpenBehaviorPreference(value: DetailsOpenBehaviorPreference): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(PREF_DETAILS_OPEN_BEHAVIOR, value);
}
