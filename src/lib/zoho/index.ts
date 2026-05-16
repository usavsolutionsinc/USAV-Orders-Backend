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
  ZohoApiError,
  type ZohoCircuitOpenError,
  type ZohoRateLimitError,
} from '@/lib/zoho/httpClient';

export { getAccessToken, getInventoryBaseUrl, paginateZohoList, ZohoApiError };
export type { ZohoCircuitOpenError, ZohoRateLimitError };

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

/** @see sumWarehouseReceivedByPoLineItem in src/lib/zoho.ts */
export async function sumWarehouseReceivedByPoLineItem(
  purchaseOrderId: string,
): Promise<Map<string, number>> {
  const poId = String(purchaseOrderId || '').trim();
  if (!poId) return new Map();

  const totals = new Map<string, number>();
  let page = 1;
  const perPage = 200;
  for (;;) {
    const pageData = await listPurchaseReceives({
      purchaseorder_id: poId,
      page,
      per_page: perPage,
    });
    const rows = pageData.purchasereceives || [];
    for (const pr of rows) {
      let lines = pr.line_items;
      const rid = String(
        pr.purchase_receive_id ?? (pr as { receive_id?: string }).receive_id ?? '',
      ).trim();
      if ((!lines || lines.length === 0) && rid) {
        try {
          const detail = await getPurchaseReceiveById(rid);
          lines = detail.purchasereceive?.line_items;
        } catch {
          lines = undefined;
        }
      }
      for (const raw of lines ?? []) {
        const li = raw as unknown as Record<string, unknown>;
        const lid = String(li.line_item_id ?? '').trim();
        if (!lid) continue;
        const q = Number(li.quantity_received ?? li.quantity ?? 0);
        if (!Number.isFinite(q) || q <= 0) continue;
        totals.set(lid, (totals.get(lid) || 0) + q);
      }
    }
    if (!pageData.page_context?.has_more_page || rows.length < perPage) break;
    page += 1;
  }
  return totals;
}

interface ZohoBillSummary {
  bill_id?: string;
  bill_number?: string;
  status?: string;
  purchaseorder_id?: string;
  purchaseorders?: Array<{ purchaseorder_id?: string }>;
}

export async function listBillsForPurchaseOrder(
  purchaseOrderId: string,
): Promise<Array<{ bill_id: string; bill_number: string; status: string }>> {
  const poId = String(purchaseOrderId || '').trim();
  if (!poId) return [];

  const matches: Array<{ bill_id: string; bill_number: string; status: string }> = [];

  const collect = (rows: ZohoBillSummary[] | undefined) => {
    for (const b of rows ?? []) {
      const id = String(b.bill_id ?? '').trim();
      if (!id) continue;
      const direct = String(b.purchaseorder_id ?? '').trim();
      const nested = (b.purchaseorders ?? []).some(
        (p) => String(p?.purchaseorder_id ?? '').trim() === poId,
      );
      if (direct === poId || nested) {
        matches.push({
          bill_id: id,
          bill_number: String(b.bill_number ?? '').trim(),
          status: String(b.status ?? '').trim(),
        });
      }
    }
  };

  try {
    const filtered = await zohoGet<
      ZohoPagedResponse<ZohoBillSummary> & { bills?: ZohoBillSummary[] }
    >('/api/v1/bills', { purchaseorder_id: poId, per_page: 200 });
    collect(filtered.bills);
    if (matches.length > 0) return matches;
  } catch {
    /* fall through to pagination */
  }

  let page = 1;
  const perPage = 200;
  for (;;) {
    const pageData = await zohoGet<
      ZohoPagedResponse<ZohoBillSummary> & { bills?: ZohoBillSummary[] }
    >('/api/v1/bills', { page, per_page: perPage });
    collect(pageData.bills);
    if (!pageData.page_context?.has_more_page || (pageData.bills?.length ?? 0) < perPage) break;
    page += 1;
    if (page > 25) break;
  }

  return matches;
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

  if (process.env.RECEIVING_MOCK_ZOHO === '1') {
    const { getMockReceivesByTracking } = await import('./mock');
    return getMockReceivesByTracking(trimmed);
  }

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
  item_id?: string;
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
  bills?: Array<{ bill_id?: string; bill_number?: string; status?: string }>;
}

export async function searchPurchaseOrdersByTracking(
  trackingNumber: string
): Promise<ZohoPurchaseOrder[]> {
  const trimmed = trackingNumber.trim();
  if (!trimmed) return [];

  if (process.env.RECEIVING_MOCK_ZOHO === '1') {
    const { getMockPurchaseOrdersByTracking } = await import('./mock');
    return getMockPurchaseOrdersByTracking(trimmed);
  }

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

export function assertPurchaseOrderReceivable(
  response: { purchaseorder?: { status?: string } } | null | undefined,
): void {
  const po = response?.purchaseorder;
  if (!po) {
    throw new Error(
      'Zoho purchase order not found or inaccessible. Confirm purchaseorder_id with GET /api/v1/purchaseorders.',
    );
  }
  const raw = String(po.status ?? '').trim();
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'draft') {
    throw new Error(
      'Zoho PO is still Draft — issue the purchase order in Zoho Inventory before recording a receive.',
    );
  }
  if (normalized === 'cancelled' || normalized === 'void') {
    throw new Error(`Zoho PO cannot be received (status: ${raw || 'cancelled'}).`);
  }
}

export function assertPurchaseOrderLineItemsEditable(
  response: { purchaseorder?: { status?: string } } | null | undefined,
): void {
  const po = response?.purchaseorder;
  if (!po) {
    throw new Error(
      'Zoho purchase order not found or inaccessible. Confirm purchaseorder_id with GET /api/v1/purchaseorders.',
    );
  }
  const raw = String(po.status ?? '').trim();
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'cancelled' || normalized === 'void') {
    throw new Error(`Zoho PO line items cannot be edited (status: ${raw || 'cancelled'}).`);
  }
}

function mergeSerialNoteIntoLineDescription(existing: string, serialNote: string): string {
  const e = existing.trim();
  const s = serialNote.trim();
  if (!s) return e;
  if (!e) return s;
  const body = s.replace(/^(SN|SNs)\s*:\s*/i, '').trim();
  const tokens = body.split(/\s*,\s*/).filter(Boolean);
  const eUpper = e.toUpperCase();
  const already = tokens.length > 0 && tokens.every((t) => eUpper.includes(t.toUpperCase()));
  if (already) return e;
  return `${e} | ${s}`;
}

export function buildPurchaseOrderLineItemsForDescriptionPut(
  po: ZohoPurchaseOrder,
  lineItemIdToSerialNote: Record<string, string>,
): Record<string, unknown>[] {
  const items = po.line_items || [];
  if (items.length === 0) return [];

  return items.map((li) => {
    const lineId = String(li.line_item_id || '').trim();
    const payload: Record<string, unknown> = {
      line_item_id: lineId,
      item_id: String(li.item_id || ''),
      quantity: Number(li.quantity ?? 0),
      rate: li.rate != null ? Number(li.rate) : 0,
    };
    if (li.item_order != null && Number.isFinite(Number(li.item_order))) {
      payload.item_order = Number(li.item_order);
    }

    const add = lineItemIdToSerialNote[lineId];
    const baseDesc = String(li.description ?? '').trim();
    const desc = add ? mergeSerialNoteIntoLineDescription(baseDesc, add) : baseDesc;
    if (desc) payload.description = desc;

    return payload;
  });
}

function defaultReceiveNumber(): string {
  const tail = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `REC-${Date.now()}-${tail}`;
}

export function getPurchaseReceiveIdFromCreateResponse(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const r = data as Record<string, unknown>;
  const nested =
    (r.purchasereceive as Record<string, unknown> | undefined) ||
    (r.purchase_receive as Record<string, unknown> | undefined);
  const raw = nested?.purchase_receive_id ?? nested?.receive_id ?? r.purchase_receive_id;
  const s = raw != null ? String(raw).trim() : '';
  return s || null;
}

/** Master catalog id for a PO line row (Zoho requires this on purchase receives). */
export function catalogItemIdFromZohoPoLineItem(li: unknown): string | null {
  if (!li || typeof li !== 'object') return null;
  const r = li as Record<string, unknown>;
  const top = r.item_id;
  if (top != null) {
    const s = String(top).trim();
    if (s) return s;
  }
  for (const key of ['item', 'item_details'] as const) {
    const nested = r[key];
    if (nested && typeof nested === 'object') {
      const id = (nested as Record<string, unknown>).item_id;
      if (id != null) {
        const s = String(id).trim();
        if (s) return s;
      }
    }
  }
  return null;
}

/**
 * Fill missing `item_id` on receive lines from GET /purchaseorders/:id `line_items`
 * (same row as `line_item_id`).
 */
export function mergeCatalogItemIdsFromPurchaseOrder(
  poDetail: { purchaseorder?: { line_items?: unknown[] } } | null | undefined,
  lineItems: ZohoPurchaseReceiveLine[],
): ZohoPurchaseReceiveLine[] {
  const items = poDetail?.purchaseorder?.line_items;
  if (!Array.isArray(items)) return lineItems;
  const byLineId = new Map<string, unknown>();
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Record<string, unknown>;
    const id = String(rec.line_item_id ?? rec.id ?? '').trim();
    if (id) byLineId.set(id, raw);
  }
  return lineItems.map((line) => {
    const existing = String(line.item_id ?? '').trim();
    if (existing) return line;
    const raw = byLineId.get(line.line_item_id);
    const resolved = raw ? catalogItemIdFromZohoPoLineItem(raw) : null;
    return resolved ? { ...line, item_id: resolved } : line;
  });
}

function resolveBillIdForPurchaseReceive(
  bills: Array<{ bill_id?: string; bill_number?: string; status?: string }> | undefined,
  opts?: { explicitBillId?: string; billNumberHint?: string },
): string | null {
  const explicit = String(opts?.explicitBillId ?? '').trim();
  if (explicit) return explicit;
  const rows = Array.isArray(bills) ? bills : [];
  const hint = String(opts?.billNumberHint ?? '').trim();
  if (hint) {
    const hintNorm = hint.toLowerCase();
    const hit = rows.find((b) => {
      const bn = String(b.bill_number ?? '').trim();
      return bn.length > 0 && bn.toLowerCase() === hintNorm;
    });
    const fromHint = String(hit?.bill_id ?? '').trim();
    if (fromHint) return fromHint;
  }
  return rows.map((b) => String(b.bill_id ?? '').trim()).find((id) => id.length > 0) ?? null;
}

type PoBillsHint = Array<{ bill_id?: string; bill_number?: string; status?: string }> | undefined;

const BILLED_PO_ERROR_SENTINELS = [
  'bill(s) without receive',
  'select an item',
];

function buildPurchaseReceiveBaseBody(
  lineItems: ZohoPurchaseReceiveLine[],
  receiveNumber: string,
  date: string,
  warehouseId?: string,
) {
  const body: Record<string, unknown> = {
    receive_number: receiveNumber,
    date,
    line_items: lineItems.map((line) => ({
      line_item_id: line.line_item_id,
      item_id: String(line.item_id ?? '').trim(),
      quantity: line.quantity_received,
    })),
  };
  if (warehouseId) body.warehouse_id = warehouseId;
  return body;
}

function buildPurchaseReceiveBilledBody(
  poId: string,
  lineItems: ZohoPurchaseReceiveLine[],
  receiveNumber: string,
  date: string,
  billId: string,
  warehouseId?: string,
) {
  const body: Record<string, unknown> = {
    purchaseorder_id: poId,
    receive_number: receiveNumber,
    date,
    purchaseorder_bills: [
      {
        bill_id: billId,
        line_items: lineItems.map((line) => ({
          line_item_id: line.line_item_id,
          item_id: String(line.item_id ?? '').trim(),
          quantity: line.quantity_received,
        })),
      },
    ],
  };
  if (warehouseId) body.warehouse_id = warehouseId;
  return body;
}

export async function createPurchaseReceive(params: {
  purchaseOrderId: string;
  warehouseId?: string;
  date?: string;
  receiveNumber?: string;
  lineItems: ZohoPurchaseReceiveLine[];
  billId?: string;
  billNumberHint?: string;
  /** PO `bills` array from a previous GET; lets us skip the proactive PO refetch. */
  bills?: PoBillsHint;
}): Promise<ZohoPagedResponse<ZohoPurchaseReceive> & { purchasereceive?: ZohoPurchaseReceive }> {
  const poId = String(params.purchaseOrderId || '').trim();
  if (!poId) throw new Error('purchaseOrderId is required');

  for (const line of params.lineItems) {
    const itemId = String(line.item_id ?? '').trim();
    if (!itemId) {
      throw new Error(
        `Zoho purchase receive requires catalog item_id for PO line ${line.line_item_id}. ` +
          `Fetch GET /purchaseorders/${poId} and use each line's item_id with line_item_id, or re-link the line.`,
      );
    }
  }

  const receiveNumber = params.receiveNumber?.trim() || defaultReceiveNumber();
  const date = params.date || getCurrentPSTDateKey();
  const query = { purchaseorder_id: poId };

  let billIdHint = resolveBillIdForPurchaseReceive(params.bills, {
    explicitBillId: params.billId,
    billNumberHint: params.billNumberHint,
  });

  if (billIdHint) {
    const billBody = buildPurchaseReceiveBilledBody(
      poId,
      params.lineItems,
      receiveNumber,
      date,
      billIdHint,
      params.warehouseId,
    );
    return zohoPost('/api/v1/purchasereceives', billBody, query);
  }

  const body = buildPurchaseReceiveBaseBody(
    params.lineItems,
    receiveNumber,
    date,
    params.warehouseId,
  );

  try {
    return await zohoPost('/api/v1/purchasereceives', body, query);
  } catch (err) {
    const isBilledPoReceive =
      err instanceof ZohoApiError &&
      BILLED_PO_ERROR_SENTINELS.some((sentinel) =>
        err.message.toLowerCase().includes(sentinel),
      );
    if (!isBilledPoReceive) throw err;

    const poResp = await getPurchaseOrderById(poId);
    billIdHint = resolveBillIdForPurchaseReceive(poResp.purchaseorder?.bills, {
      explicitBillId: params.billId,
      billNumberHint: params.billNumberHint,
    });

    if (!billIdHint) {
      const bills = await listBillsForPurchaseOrder(poId).catch(() => []);
      billIdHint = resolveBillIdForPurchaseReceive(bills, {
        explicitBillId: params.billId,
        billNumberHint: params.billNumberHint,
      });
    }

    if (!billIdHint) throw err;

    const billBody = buildPurchaseReceiveBilledBody(
      poId,
      params.lineItems,
      receiveNumber,
      date,
      billIdHint,
      params.warehouseId,
    );
    return zohoPost('/api/v1/purchasereceives', billBody, query);
  }
}

export async function updatePurchaseOrder(
  purchaseOrderId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const safeId = encodeURIComponent(String(purchaseOrderId || '').trim());
  if (!safeId) throw new Error('purchaseOrderId is required');
  return zohoPut(`/api/v1/purchaseorders/${safeId}`, body);
}
