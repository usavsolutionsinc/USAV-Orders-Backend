/**
 * ShipStation legacy v1 order client — the ORDER-DATA source.
 *
 * Base: https://ssapi.shipstation.com, HTTP Basic auth (apiKey:apiSecret). This
 * is the ONLY ShipStation API that returns orders with line items, SKUs, and
 * per-item + order-level WEIGHT — v2 has no order-list endpoint (see ./client.ts
 * header). Two consumers:
 *   1. the connection sync adapter (connectors/shipstation.ts) — `listOrders`
 *      pulls the org's orders into our `orders` table.
 *   2. the rate/label endpoints — `getOrderByNumber` fetches the order's STORED
 *      weight + ship-to so a v2 rate/label reuses it (the user's chosen weight
 *      source), no local weight column needed.
 *
 * Credential-injected + Zod-validated at the boundary; maps raw v1 JSON into the
 * normalized ./types shapes. No vault/tenant imports — testable with a fake key.
 */

import { z } from 'zod';
import type { ShipAddress, WeightUnit } from './types';

const DEFAULT_BASE_URL = process.env.SHIPSTATION_V1_BASE_URL ?? 'https://ssapi.shipstation.com';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;

export class ShipStationV1Error extends Error {
  constructor(readonly httpStatus: number, message: string) {
    super(message);
    this.name = 'ShipStationV1Error';
  }
  get isNotConnected(): boolean {
    return this.httpStatus === 401 || this.httpStatus === 403;
  }
}

/** One line item on a v1 order. */
export interface ShipStationV1Item {
  sku: string | null;
  name: string | null;
  quantity: number;
  unitPrice: number | null;
  weightOz: number | null;
}

/** A normalized v1 order — enough to sync into `orders` and to build a rate. */
export interface ShipStationV1Order {
  orderId: number;
  orderNumber: string;
  orderDate: string | null;
  modifyDate: string | null;
  orderStatus: string | null;
  customerEmail: string | null;
  shipTo: ShipAddress | null;
  items: ShipStationV1Item[];
  orderTotal: number | null;
  /** Order-level parcel weight, normalized. Feeds the v2 rate/label package. */
  weight: { value: number; unit: WeightUnit } | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function basicAuth(apiKey: string, apiSecret: string): string {
  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`;
}

/** ShipStation v1 weight.units → our WeightUnit. */
function normalizeWeightUnit(units: string | null | undefined): WeightUnit {
  switch ((units ?? '').toLowerCase()) {
    case 'pounds':
      return 'pound';
    case 'grams':
      return 'gram';
    case 'ounces':
    default:
      return 'ounce';
  }
}

const V1WeightSchema = z.object({ value: z.number().nullish(), units: z.string().nullish() }).nullish();

const V1AddressSchema = z
  .object({
    name: z.string().nullish(),
    company: z.string().nullish(),
    street1: z.string().nullish(),
    street2: z.string().nullish(),
    city: z.string().nullish(),
    state: z.string().nullish(),
    postalCode: z.string().nullish(),
    country: z.string().nullish(),
    phone: z.string().nullish(),
    residential: z.boolean().nullish(),
  })
  .nullish();

const V1ItemSchema = z.object({
  sku: z.string().nullish(),
  name: z.string().nullish(),
  quantity: z.number().nullish(),
  unitPrice: z.number().nullish(),
  weight: V1WeightSchema,
});

const V1OrderSchema = z.object({
  orderId: z.number(),
  orderNumber: z.string(),
  orderDate: z.string().nullish(),
  modifyDate: z.string().nullish(),
  orderStatus: z.string().nullish(),
  customerEmail: z.string().nullish(),
  shipTo: V1AddressSchema,
  items: z.array(V1ItemSchema).nullish(),
  orderTotal: z.number().nullish(),
  weight: V1WeightSchema,
});

const V1OrdersResponseSchema = z.object({
  orders: z.array(z.unknown()).nullish(),
  total: z.number().nullish(),
  page: z.number().nullish(),
  pages: z.number().nullish(),
});

function toShipAddress(raw: z.infer<typeof V1AddressSchema>): ShipAddress | null {
  if (!raw || !raw.street1 || !raw.city) return null;
  return {
    name: raw.name ?? '',
    phone: raw.phone ?? null,
    company: raw.company ?? null,
    addressLine1: raw.street1,
    addressLine2: raw.street2 ?? null,
    cityLocality: raw.city,
    stateProvince: raw.state ?? '',
    postalCode: raw.postalCode ?? '',
    countryCode: (raw.country ?? 'US').toUpperCase(),
    residential: raw.residential ?? null,
  };
}

function mapOrder(raw: z.infer<typeof V1OrderSchema>): ShipStationV1Order {
  const items: ShipStationV1Item[] = (raw.items ?? []).map((it) => ({
    sku: it.sku ?? null,
    name: it.name ?? null,
    quantity: typeof it.quantity === 'number' ? it.quantity : 1,
    unitPrice: it.unitPrice ?? null,
    weightOz:
      it.weight && typeof it.weight.value === 'number'
        ? toOunces(it.weight.value, it.weight.units)
        : null,
  }));
  const weight =
    raw.weight && typeof raw.weight.value === 'number'
      ? { value: raw.weight.value, unit: normalizeWeightUnit(raw.weight.units) }
      : null;
  return {
    orderId: raw.orderId,
    orderNumber: raw.orderNumber,
    orderDate: raw.orderDate ?? null,
    modifyDate: raw.modifyDate ?? null,
    orderStatus: raw.orderStatus ?? null,
    customerEmail: raw.customerEmail ?? null,
    shipTo: toShipAddress(raw.shipTo),
    items,
    orderTotal: raw.orderTotal ?? null,
    weight,
  };
}

function toOunces(value: number, units: string | null | undefined): number {
  switch ((units ?? '').toLowerCase()) {
    case 'pounds':
      return value * 16;
    case 'grams':
      return value / 28.3495;
    default:
      return value;
  }
}

async function v1Fetch(
  apiKey: string,
  apiSecret: string,
  baseUrl: string,
  path: string,
): Promise<unknown> {
  const retryable = new Set([429, 500, 502, 503, 504]);
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        headers: { Authorization: basicAuth(apiKey, apiSecret), Accept: 'application/json' },
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        throw new ShipStationV1Error(503, err instanceof Error ? err.message : 'network error');
      }
      await sleep(500 * 2 ** attempt);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (retryable.has(res.status) && attempt < MAX_RETRIES) {
      // v1 exposes X-Rate-Limit-Reset (seconds) on 429.
      const reset = Number(res.headers.get('X-Rate-Limit-Reset'));
      const delay = res.status === 429 && Number.isFinite(reset) ? reset * 1000 : 500 * 2 ** attempt;
      await sleep(Math.min(delay, 60_000));
      continue;
    }

    const text = await res.text().catch(() => '');
    if (!res.ok) {
      throw new ShipStationV1Error(res.status, text ? text.slice(0, 300) : `v1 error ${res.status}`);
    }
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      throw new ShipStationV1Error(502, 'Malformed v1 JSON response');
    }
  }
  throw new ShipStationV1Error(503, 'v1 request exhausted retries');
}

export interface ListOrdersParams {
  /** ISO date; pulls orders modified at/after this (incremental sync watermark). */
  modifyDateStart?: string;
  page?: number;
  pageSize?: number;
}

export interface ListOrdersResult {
  orders: ShipStationV1Order[];
  page: number;
  pages: number;
  total: number;
}

export interface ShipStationV1Client {
  listOrders(params?: ListOrdersParams): Promise<ListOrdersResult>;
  getOrderByNumber(orderNumber: string): Promise<ShipStationV1Order | null>;
}

export function createShipStationV1Client(
  apiKey: string,
  apiSecret: string,
  baseUrl: string = DEFAULT_BASE_URL,
): ShipStationV1Client {
  const listOrders = async (params: ListOrdersParams = {}): Promise<ListOrdersResult> => {
    const q = new URLSearchParams({
      page: String(params.page ?? 1),
      pageSize: String(params.pageSize ?? 100),
      sortBy: 'ModifyDate',
      sortDir: 'ASC',
    });
    if (params.modifyDateStart) q.set('modifyDateStart', params.modifyDateStart);
    const json = await v1Fetch(apiKey, apiSecret, baseUrl, `/orders?${q.toString()}`);
    const parsed = V1OrdersResponseSchema.safeParse(json);
    const raw = parsed.success ? parsed.data : { orders: [], page: 1, pages: 1, total: 0 };
    const orders: ShipStationV1Order[] = [];
    for (const o of raw.orders ?? []) {
      const order = V1OrderSchema.safeParse(o);
      if (order.success) orders.push(mapOrder(order.data));
    }
    return {
      orders,
      page: raw.page ?? 1,
      pages: raw.pages ?? 1,
      total: raw.total ?? orders.length,
    };
  };

  const getOrderByNumber = async (orderNumber: string): Promise<ShipStationV1Order | null> => {
    const json = await v1Fetch(
      apiKey,
      apiSecret,
      baseUrl,
      `/orders?orderNumber=${encodeURIComponent(orderNumber)}&pageSize=1`,
    );
    const parsed = V1OrdersResponseSchema.safeParse(json);
    const first = parsed.success ? parsed.data.orders?.[0] : undefined;
    if (!first) return null;
    const order = V1OrderSchema.safeParse(first);
    return order.success ? mapOrder(order.data) : null;
  };

  return { listOrders, getOrderByNumber };
}
