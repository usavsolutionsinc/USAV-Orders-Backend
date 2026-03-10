/**
 * Zoho Inventory API Client for Next.js
 */

import {
  getCachedZohoAccessToken,
  getZohoRefreshTokenFromKv,
  setZohoTokens,
} from '@/lib/zoho-kv';

const ZOHO_ORG_ID = process.env.ZOHO_ORG_ID;
const ZOHO_DOMAIN = process.env.ZOHO_DOMAIN || 'accounts.zoho.com';
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;

/**
 * Returns a valid Zoho access token.
 *
 * Resolution order:
 *  1. Upstash KV cached access token (set on last successful refresh)
 *  2. Refresh using ZOHO_REFRESH_TOKEN env var (if set)
 *  3. Refresh using refresh token stored in KV (set by /api/zoho/oauth/callback)
 */
export async function getAccessToken(): Promise<string> {
  // 1. Return cached access token from KV if still valid
  const cached = await getCachedZohoAccessToken();
  if (cached) return cached;

  const clientId = ZOHO_CLIENT_ID;
  const clientSecret = ZOHO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET must be set. ' +
        'Visit /api/zoho/oauth/authorize to connect your Zoho account.'
    );
  }

  // 2. Resolve refresh token: env var takes priority, then KV
  const refreshToken =
    process.env.ZOHO_REFRESH_TOKEN || (await getZohoRefreshTokenFromKv());

  if (!refreshToken) {
    throw new Error(
      'No Zoho refresh token available. ' +
        'Visit /api/zoho/oauth/authorize to complete OAuth setup.'
    );
  }

  const tokenUrl = `https://${ZOHO_DOMAIN}/oauth/v2/token`;
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Zoho token refresh failed: ${response.status}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Zoho token refresh error: ${data.error}`);
  }

  const accessToken: string = data.access_token;
  const expiresIn: number = data.expires_in_sec || data.expires_in || 3600;

  // Persist the fresh access token to KV (no new refresh token on refresh grant)
  await setZohoTokens({ accessToken, expiresIn });

  return accessToken;
}

/**
 * Returns the Zoho Inventory API base URL for the configured domain.
 * Uses the www.zohoapis.com/inventory/v1 format for US (default), as
 * inventory.zohoapis.com may not resolve on all DNS configurations.
 * Path prefix (/api/v1 or /inventory/v1) is included in the base URL.
 */
export function getInventoryBaseUrl() {
  if (ZOHO_DOMAIN.includes('.eu')) return 'https://inventory.zohoapis.eu/api/v1';
  if (ZOHO_DOMAIN.includes('.in')) return 'https://inventory.zohoapis.in/api/v1';
  if (ZOHO_DOMAIN.includes('.com.au')) return 'https://inventory.zohoapis.com.au/api/v1';
  if (ZOHO_DOMAIN.includes('.ca')) return 'https://inventory.zohoapis.ca/api/v1';
  if (ZOHO_DOMAIN.includes('.jp')) return 'https://inventory.zohoapis.jp/api/v1';
  // US: use www.zohoapis.com/inventory/v1 — resolves reliably
  return 'https://www.zohoapis.com/inventory/v1';
}

export async function searchItemBySku(sku: string) {
  const normalizedSku = sku.replace(/^0+/, '') || '0';
  const data = await zohoInventoryRequest<{
    items?: ZohoItem[];
  }>('/api/v1/items', {
    search_text: normalizedSku,
  });
  const items = data.items || [];

  return items.find((item: any) => {
    const itemSku = String(item.sku || '').replace(/^0+/, '') || '0';
    return itemSku.toLowerCase() === normalizedSku.toLowerCase();
  }) || items[0] || null;
}

export function getStockInfo(item: any) {
  if (!item) return { availableQty: 0, status: 'Not Found' };

  let availableQty = 0;
  if (item.available_stock !== undefined) availableQty = Number(item.available_stock);
  else if (item.stock_on_hand !== undefined) availableQty = Number(item.stock_on_hand);
  
  return {
    availableQty,
    status: availableQty > 0 ? 'In Stock' : 'Out of Stock'
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
}

interface ZohoPagedResponse<T> {
  code: number;
  message?: string;
  page_context?: {
    page?: number;
    per_page?: number;
    has_more_page?: boolean;
    report_name?: string;
    applied_filter?: string;
    sort_column?: string;
    sort_order?: string;
  };
  [key: string]: unknown;
}

function requireOrgId(): string {
  if (!ZOHO_ORG_ID) throw new Error('ZOHO_ORG_ID missing');
  return ZOHO_ORG_ID;
}

export async function zohoInventoryRequest<T = unknown>(
  path: string,
  query: Record<string, string | number | boolean | null | undefined> = {}
): Promise<T> {
  const orgId = requireOrgId();
  const accessToken = await getAccessToken();
  const baseUrl = getInventoryBaseUrl();
  const params = new URLSearchParams({
    organization_id: orgId,
  });

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    params.set(key, String(value));
  });

  // Normalize path: strip leading /api/v1 since it's now included in getInventoryBaseUrl()
  let normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (normalizedPath.startsWith('/api/v1')) {
    normalizedPath = normalizedPath.slice('/api/v1'.length) || '/';
  }
  const url = `${baseUrl}${normalizedPath}?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });
  } catch (fetchErr: unknown) {
    const cause = (fetchErr as any)?.cause;
    const causeMsg = cause?.code || cause?.message || '';
    const baseMsg = fetchErr instanceof Error ? fetchErr.message : 'fetch failed';
    throw new Error(causeMsg ? `${baseMsg} (${causeMsg})` : baseMsg);
  }

  if (response.status === 401) {
    throw new Error(
      'Zoho access token is invalid or expired. Re-authorize at /api/zoho/oauth/authorize'
    );
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(`Zoho API error ${response.status}: ${bodyText || 'No response body'}`);
  }

  const json = await response.json() as Record<string, unknown>;
  // Zoho returns code:0 for success; non-zero means API-level error
  if (typeof json.code === 'number' && json.code !== 0) {
    throw new Error(`Zoho API code ${json.code}: ${json.message || 'unknown error'}`);
  }

  return json as T;
}

export async function listPurchaseReceives(params: {
  page?: number;
  per_page?: number;
  last_modified_time?: string;
  purchaseorder_id?: string;
} = {}): Promise<ZohoPagedResponse<ZohoPurchaseReceive> & { purchasereceives?: ZohoPurchaseReceive[] }> {
  return zohoInventoryRequest('/api/v1/purchasereceives', params);
}

export async function getPurchaseReceiveById(
  purchaseReceiveId: string
): Promise<ZohoPagedResponse<ZohoPurchaseReceive> & { purchasereceive?: ZohoPurchaseReceive }> {
  const safeId = encodeURIComponent(String(purchaseReceiveId || '').trim());
  if (!safeId) throw new Error('purchaseReceiveId is required');
  return zohoInventoryRequest(`/api/v1/purchasereceives/${safeId}`);
}

export async function listWarehouses(params: {
  page?: number;
  per_page?: number;
} = {}): Promise<ZohoPagedResponse<ZohoWarehouse> & { warehouses?: ZohoWarehouse[] }> {
  return zohoInventoryRequest('/api/v1/warehouses', params);
}

/**
 * Search Zoho purchase receives by tracking number.
 * Uses the search_text param which Zoho supports for fuzzy matching across fields.
 */
export async function searchPurchaseReceivesByTracking(
  trackingNumber: string
): Promise<ZohoPurchaseReceive[]> {
  const trimmed = trackingNumber.trim();
  if (!trimmed) return [];

  const data = await zohoInventoryRequest<
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

// ─── Purchase Orders ─────────────────────────────────────────────────────────

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
  /** draft | open | billed | cancelled */
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

/**
 * Search Zoho Purchase Orders by tracking number or reference number.
 * Runs two parallel queries — one against reference_number, one via search_text —
 * then deduplicates and returns all matching open/billed POs.
 *
 * Note: Zoho's search_text is a fuzzy full-text search across PO fields.
 * For tracking numbers on the vendor's shipment, reference_number is the most
 * likely field, but search_text catches custom fields and notes too.
 */
export async function searchPurchaseOrdersByTracking(
  trackingNumber: string
): Promise<ZohoPurchaseOrder[]> {
  const trimmed = trackingNumber.trim();
  if (!trimmed) return [];

  const [byRef, bySearch] = await Promise.allSettled([
    zohoInventoryRequest<ZohoPagedResponse<ZohoPurchaseOrder> & { purchaseorders?: ZohoPurchaseOrder[] }>(
      '/api/v1/purchaseorders',
      { reference_number: trimmed, status: 'open', per_page: 10 }
    ),
    zohoInventoryRequest<ZohoPagedResponse<ZohoPurchaseOrder> & { purchaseorders?: ZohoPurchaseOrder[] }>(
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
  /** Filter by status: draft | open | billed | cancelled */
  status?: string;
  search_text?: string;
  purchaseorder_number?: string;
  vendor_id?: string;
  last_modified_time?: string;
} = {}): Promise<ZohoPagedResponse<ZohoPurchaseOrder> & { purchaseorders?: ZohoPurchaseOrder[] }> {
  return zohoInventoryRequest('/api/v1/purchaseorders', params);
}

export async function getPurchaseOrderById(
  purchaseOrderId: string
): Promise<ZohoPagedResponse<ZohoPurchaseOrder> & { purchaseorder?: ZohoPurchaseOrder }> {
  const safeId = encodeURIComponent(String(purchaseOrderId || '').trim());
  if (!safeId) throw new Error('purchaseOrderId is required');
  return zohoInventoryRequest(`/api/v1/purchaseorders/${safeId}`);
}

/**
 * Create a purchase receive in Zoho Inventory (marks PO items as physically received).
 * Used after unboxing confirmation in Mode 2.
 */
export async function createPurchaseReceive(params: {
  purchaseOrderId: string;
  warehouseId?: string;
  date?: string;
  lineItems: ZohoPurchaseReceiveLine[];
}): Promise<ZohoPagedResponse<ZohoPurchaseReceive> & { purchasereceive?: ZohoPurchaseReceive }> {
  const orgId = requireOrgId();
  const accessToken = await getAccessToken();
  const baseUrl = getInventoryBaseUrl();

  const body = {
    purchaseorder_id: params.purchaseOrderId,
    date: params.date || new Date().toISOString().substring(0, 10),
    warehouse_id: params.warehouseId,
    line_items: params.lineItems.map((l) => ({
      line_item_id: l.line_item_id,
      quantity_received: l.quantity_received,
    })),
  };

  const url = `${baseUrl}/api/v1/purchasereceives?organization_id=${orgId}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(`Zoho createPurchaseReceive error ${response.status}: ${bodyText || 'No response body'}`);
  }

  return response.json();
}
