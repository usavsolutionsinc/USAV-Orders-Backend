'use client';

import type { ShippedOrder } from '@/lib/neon/orders-queries';
import type { ShippedDetailsContext } from '@/utils/events';

export type DashboardOrderView = 'pending' | 'unshipped' | 'shipped' | 'fba';
export type DashboardCacheEntry = readonly [unknown, unknown];

export interface DashboardSelectionSnapshot {
  order: ShippedOrder;
  context: ShippedDetailsContext;
  savedAt: number;
}

export interface DashboardAssignmentUpdateDetail {
  orderIds?: unknown[];
  testerId?: number | null;
  packerId?: number | null;
  shipByDate?: string | null;
  outOfStock?: string | null;
  notes?: string | null;
  shippingTrackingNumber?: string | null;
  itemNumber?: string | null;
  condition?: string | null;
}

export function getDashboardOrderViewFromSearch(
  searchParams: Pick<URLSearchParams, 'has'>
): DashboardOrderView {
  if (searchParams.has('shipped')) return 'shipped';
  if (searchParams.has('unshipped')) return 'unshipped';
  if (searchParams.has('pending')) return 'pending';
  if (searchParams.has('fba')) return 'fba';
  return 'pending';
}

export function normalizeDashboardOrderViewParams(
  params: URLSearchParams,
  preferredView?: DashboardOrderView
): DashboardOrderView {
  const nextView = preferredView ?? getDashboardOrderViewFromSearch(params);
  params.delete('unshipped');
  params.delete('pending');
  params.delete('shipped');
  params.delete('fba');
  params.set(nextView, '');
  return nextView;
}

export function parseDashboardOpenOrderId(raw: string | null | undefined): number | null {
  const value = Number(String(raw || '').trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function normalizeDashboardDetailsContext(
  order: Pick<ShippedOrder, 'packed_at'>,
  context?: ShippedDetailsContext
): ShippedDetailsContext {
  if (context) return context;
  return order.packed_at ? 'shipped' : 'queue';
}

export function extractOrdersFromDashboardCacheEntry(value: unknown): ShippedOrder[] {
  if (Array.isArray(value)) return value as ShippedOrder[];
  if (!value || typeof value !== 'object') return [];

  const record = value as { orders?: unknown; results?: unknown; shipped?: unknown };
  if (Array.isArray(record.orders)) return record.orders as ShippedOrder[];
  if (Array.isArray(record.results)) return record.results as ShippedOrder[];
  if (Array.isArray(record.shipped)) return record.shipped as ShippedOrder[];
  return [];
}

export function findDashboardSelectedOrderInCache(
  cachedEntries: DashboardCacheEntry[],
  openOrderId: number
): { order: ShippedOrder; context: ShippedDetailsContext } | null {
  for (const [, value] of cachedEntries) {
    const match = extractOrdersFromDashboardCacheEntry(value).find((record) => Number(record.id) === openOrderId);
    if (match) {
      const context = normalizeDashboardDetailsContext(match);
      return { order: match, context };
    }
  }

  return null;
}

export function resolveDashboardSelectedOrderCandidate(args: {
  openOrderId: number;
  cachedEntries: DashboardCacheEntry[];
  storedSelection: DashboardSelectionSnapshot | null;
}): { order: ShippedOrder; context: ShippedDetailsContext } | null {
  const cached = findDashboardSelectedOrderInCache(args.cachedEntries, args.openOrderId);
  if (cached) return cached;

  if (Number(args.storedSelection?.order?.id) === args.openOrderId && args.storedSelection?.order) {
    return {
      order: args.storedSelection.order,
      context: args.storedSelection.context,
    };
  }

  return null;
}

export function patchDashboardSelectedOrderFromAssignment(
  current: ShippedOrder | null,
  detail: DashboardAssignmentUpdateDetail
): ShippedOrder | null {
  if (!current) return current;

  const idSet = new Set((detail.orderIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id)));
  if (idSet.size === 0 || !idSet.has(Number(current.id))) return current;

  const next: ShippedOrder & Record<string, unknown> = { ...current };
  if (detail.testerId !== undefined) next.tester_id = detail.testerId;
  if (detail.packerId !== undefined) next.packer_id = detail.packerId;
  if (detail.shipByDate !== undefined) next.ship_by_date = detail.shipByDate;
  if (detail.outOfStock !== undefined) next.out_of_stock = detail.outOfStock;
  if (detail.notes !== undefined) next.notes = detail.notes ?? '';
  if (detail.shippingTrackingNumber !== undefined) next.shipping_tracking_number = detail.shippingTrackingNumber;
  if (detail.itemNumber !== undefined) next.item_number = detail.itemNumber;
  if (detail.condition !== undefined) next.condition = detail.condition ?? '';
  return next;
}
