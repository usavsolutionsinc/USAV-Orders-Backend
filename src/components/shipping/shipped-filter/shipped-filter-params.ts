import type { CarrierCode, ShipmentStatusCategory } from '@/components/shipping/ShipmentStatusBadge';
import { VALID_CARRIERS, VALID_STATUS, type ShippedTypeFilter } from './shipped-filter-constants';

type ParamReader = URLSearchParams | { get: (k: string) => string | null };

export function readShippedCarrierFilter(searchParams: ParamReader): CarrierCode | null {
  const raw = String(searchParams.get('carrier') || '').toUpperCase();
  return VALID_CARRIERS.has(raw as CarrierCode) ? (raw as CarrierCode) : null;
}

export function readShippedStatusFilter(searchParams: ParamReader): ShipmentStatusCategory | null {
  const raw = String(searchParams.get('statusCategory') || '').toUpperCase();
  return VALID_STATUS.has(raw as ShipmentStatusCategory) ? (raw as ShipmentStatusCategory) : null;
}

export function readShippedExceptionsFilter(searchParams: ParamReader): boolean {
  const raw = String(searchParams.get('exceptions') || '').toLowerCase();
  return raw === '1' || raw === 'true';
}

export function readShippedTypeFilter(searchParams: ParamReader): ShippedTypeFilter {
  const raw = String(searchParams.get('shippedFilter') || '').toLowerCase();
  if (raw === 'orders' || raw === 'sku' || raw === 'fba') return raw;
  return 'all';
}

export function parseStaffId(raw: string | null): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseISODate(raw: string | null): Date | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return undefined;
  const d = new Date(`${raw.trim()}T00:00:00`);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

export function toISODate(d: Date | undefined): string | null {
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
