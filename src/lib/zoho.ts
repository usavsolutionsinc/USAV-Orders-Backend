/**
 * Zoho Inventory API surface.
 *
 * HTTP concerns such as rate limiting, retry/backoff, pagination discipline,
 * and circuit-breaking live in src/lib/zoho/httpClient.ts.
 */

import { getCurrentPSTDateKey } from '@/utils/date';
import { getAccessToken, getInventoryBaseUrl } from '@/lib/zoho/core';
import {
  paginateZohoList,
  zohoGet,
  zohoPost,
  zohoPut,
  type ZohoApiError,
  type ZohoCircuitOpenError,
  type ZohoRateLimitError,
} from '@/lib/zoho/httpClient';

export { getAccessToken, getInventoryBaseUrl, paginateZohoList };
export type { ZohoApiError, ZohoCircuitOpenError, ZohoRateLimitError };

export async function searchItemBySku(sku: string) {
  const normalizedSku = sku.replace(/^0+/, '') || '0';
  const data = await zohoInventoryRequest<{ items?: ZohoItem[] }>('/api/v1/items', {
    search_text: normalizedSku,
  });
  const items = data.items || [];

  return items.find((item: ZohoItem) => {
    const itemSku = String(item.sku || '').replace(/^0+/, '') || '0';
    return itemSku.toLowerCase() === normalizedSku.toLowerCase();
  }) || items[0] || null;
}

export function getStockInfo(item: ZohoItem | null | undefined) {
  if (!item) return { availableQty: 0, status: 'Not Found' };

  let availableQty = 0;
  if (item.available_stock !== undefined) availableQty = Number(item.available_stock);
  else if (item.stock_on_hand !== undefined) availableQty = Number(item.stock_on_hand);

  return {
    availableQty,
    status: availableQty > 0 ? 'In Stock' : 'Out of Stock',
  };
}

export interface ZohoItem {
  item_id: string;
  name?: string;
  sku?: string;
  available_stock?: number;
  stock_on_hand?: number;
}

export interface ZohoWarehouse {
  warehouse_id: string;
  warehouse_name: string;
  status?: string;
}

export interface ZohoPurchaseReceive {
  purchase_receive_id: string;
  purchaseorder_id?: string;
  purchaseorder_number?: string;
  date?: string;
  status?: string;
  vendor_name?: string;
  warehouse_id?: string;
  warehouse_name?: string;
  line_items?: ZohoPurchaseReceiveLine[];
}

export interface ZohoPageContext {
  page?: number;
  per_page?: number;
  has_more_page?: boolean;
  report_name?: string;
  applied_filter?: string;
  sort_column?: string;
  sort_order?: string;
}

export interface ZohoPagedResponse<T> {
  code: number;
  message?: string;
  page_context?: ZohoPageContext;
  [key: string]: unknown;
}

export async function zohoInventoryRequest<T = unknown>(
  path: string,
  query: Record<string, string | number | boolean | null | undefined> = {}
): Promise<T> {
  return zohoGet<T>(path, query);
}

export async function listPurchaseReceives(params: {
  page?: number;
  per_page?: number;
  last_modified_time?: string;
  purchaseorder_id?: string;
} = {}): Promise<ZohoPagedResponse<ZohoPurchaseReceive> & { purchasereceives?: ZohoPurchaseReceive[] }> {
  return zohoGet('/api/v1/purchasereceives', params);
}

export async function getPurchaseReceiveById(
  purchaseReceiveId: string
): Promise<ZohoPagedResponse<ZohoPurchaseReceive> & { purchasereceive?: ZohoPurchaseReceive }> {
  const safeId = encodeURIComponent(String(purchaseReceiveId || '').trim());
  if (!safeId) throw new Error('purchaseReceiveId is required');
  return zohoGet(`/api/v1/purchasereceives/${safeId}`);
}

export async function listWarehouses(params: {
  page?: number;
  per_page?: number;
} = {}): Promise<ZohoPagedResponse<ZohoWarehouse> & { warehouses?: ZohoWarehouse[] }> {
  return zohoGet('/api/v1/warehouses', params);
}

export async function searchPurchaseReceivesByTracking(
  trackingNumber: string
): Promise<ZohoPurchaseReceive[]> {
  const trimmed = trackingNumber.trim();
  if (!trimmed) return [];

  const data = await zohoGet<
    ZohoPagedResponse<ZohoPurchaseReceive> & { purchasereceives?: ZohoPurchaseReceive[] }
  >('/api/v1/purchasereceives', {
    search_text: trimmed,
    per_page: 5,
  });

  return data.purchasereceives || [];
}

export interface ZohoPurchaseReceiveLine {
  line_item_id: string;
  quantity_received: number;
}

export interface ZohoPurchaseOrderLine {
  line_item_id: string;
  item_id: string;
  name?: string;
  description?: string;
  sku?: string;
  quantity?: number;
  quantity_received?: number;
  rate?: number;
  total?: number;
  unit?: string;
  item_order?: number;
  account_id?: string;
}

export interface ZohoPurchaseOrder {
  purchaseorder_id: string;
  purchaseorder_number?: string;
  vendor_id?: string;
  vendor_name?: string;
  status?: string;
  date?: string;
  delivery_date?: string;
  expected_delivery_date?: string;
  total?: number;
  sub_total?: number;
  currency_code?: string;
  warehouse_id?: string;
  warehouse_name?: string;
  line_items?: ZohoPurchaseOrderLine[];
  notes?: string;
  reference_number?: string;
}

export async function searchPurchaseOrdersByTracking(
  trackingNumber: string
): Promise<ZohoPurchaseOrder[]> {
  const trimmed = trackingNumber.trim();
  if (!trimmed) return [];

  const [byRef, bySearch] = await Promise.allSettled([
    zohoGet<ZohoPagedResponse<ZohoPurchaseOrder> & { purchaseorders?: ZohoPurchaseOrder[] }>(
      '/api/v1/purchaseorders',
      { reference_number: trimmed, per_page: 10 }
    ),
    zohoGet<ZohoPagedResponse<ZohoPurchaseOrder> & { purchaseorders?: ZohoPurchaseOrder[] }>(
      '/api/v1/purchaseorders',
      { search_text: trimmed, per_page: 10 }
    ),
  ]);

  const seen = new Set<string>();
  const results: ZohoPurchaseOrder[] = [];

  for (const settled of [byRef, bySearch]) {
    if (settled.status !== 'fulfilled') continue;
    for (const po of settled.value.purchaseorders || []) {
      if (!po.purchaseorder_id || seen.has(po.purchaseorder_id)) continue;
      seen.add(po.purchaseorder_id);
      results.push(po);
    }
  }

  return results;
}

export async function listPurchaseOrders(params: {
  page?: number;
  per_page?: number;
  status?: string;
  search_text?: string;
  purchaseorder_number?: string;
  vendor_id?: string;
  last_modified_time?: string;
} = {}): Promise<ZohoPagedResponse<ZohoPurchaseOrder> & { purchaseorders?: ZohoPurchaseOrder[] }> {
  return zohoGet('/api/v1/purchaseorders', params);
}

export async function getPurchaseOrderById(
  purchaseOrderId: string
): Promise<ZohoPagedResponse<ZohoPurchaseOrder> & { purchaseorder?: ZohoPurchaseOrder }> {
  const safeId = encodeURIComponent(String(purchaseOrderId || '').trim());
  if (!safeId) throw new Error('purchaseOrderId is required');
  return zohoGet(`/api/v1/purchaseorders/${safeId}`);
}

export async function createPurchaseReceive(params: {
  purchaseOrderId: string;
  warehouseId?: string;
  date?: string;
  lineItems: ZohoPurchaseReceiveLine[];
}): Promise<ZohoPagedResponse<ZohoPurchaseReceive> & { purchasereceive?: ZohoPurchaseReceive }> {
  return zohoPost('/api/v1/purchasereceives', {
    purchaseorder_id: params.purchaseOrderId,
    date: params.date || getCurrentPSTDateKey(),
    warehouse_id: params.warehouseId,
    line_items: params.lineItems.map((line) => ({
      line_item_id: line.line_item_id,
      quantity_received: line.quantity_received,
    })),
  });
}

export async function updatePurchaseOrder(
  purchaseOrderId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const safeId = encodeURIComponent(String(purchaseOrderId || '').trim());
  if (!safeId) throw new Error('purchaseOrderId is required');
  return zohoPut(`/api/v1/purchaseorders/${safeId}`, body);
}
