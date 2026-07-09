/**
 * ShipStation API v2 (ShipEngine) client — the label ENGINE.
 *
 * Base: https://api.shipstation.com/v2, `API-Key` header. Covers rate-shop,
 * label purchase (from a quoted rate or straight from a shipment), void, carrier
 * discovery, and label-byte download. Raw provider JSON is validated at the
 * boundary (Zod) and mapped into the normalized shapes in ./types — nothing
 * ShipStation-specific leaks past this module.
 *
 * Credential-injected (the v2 API key is passed in), so this file never imports
 * the vault or the tenant layer and is unit-testable with a fake key + fetch.
 * Vault resolution + the tenant ship-from live in ./config.
 *
 * NOTE: v2 has no order-list endpoint and no create-label-from-order shortcut —
 * order pull + stored weight come from the v1 client (./orders-v1). See
 * docs/shipstation-outbound.md.
 */

import { z } from 'zod';
import type {
  EngineCarrier,
  LabelPurchaseResult,
  Parcel,
  RateQuoteResult,
  ShipAddress,
  ShipmentSpec,
  ShippingRateOption,
} from './types';

const DEFAULT_BASE_URL = process.env.SHIPSTATION_V2_BASE_URL ?? 'https://api.shipstation.com/v2';
// Label creation calls the carrier synchronously and can be slow; give them room.
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

export class ShipStationApiError extends Error {
  constructor(
    readonly httpStatus: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ShipStationApiError';
  }
  /** 401/403 → the org's ShipStation key is missing/invalid, not a transient error. */
  get isNotConnected(): boolean {
    return this.httpStatus === 401 || this.httpStatus === 403;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds * 1000) : null;
}

/** ShipStation errors: `{ errors: [{ message, error_code }] }` or `{ message }`. */
function extractErrorMessage(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const b = body as { errors?: Array<{ message?: string }>; message?: string };
    if (Array.isArray(b.errors) && b.errors.length) {
      const msg = b.errors.map((e) => e?.message).filter(Boolean).join('; ');
      if (msg) return msg;
    }
    if (typeof b.message === 'string' && b.message) return b.message;
  }
  return `ShipStation API error ${status}`;
}

async function ssFetch(
  apiKey: string,
  baseUrl: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<unknown> {
  const retryable = new Set([429, 500, 502, 503, 504]);
  let lastErr: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'API-Key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES) break;
      await sleep(500 * 2 ** attempt);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (retryable.has(res.status) && attempt < MAX_RETRIES) {
      const delay = res.status === 429 ? parseRetryAfterMs(res.headers.get('Retry-After')) ?? 1000 * 2 ** attempt : 500 * 2 ** attempt;
      await sleep(delay);
      continue;
    }

    const text = await res.text().catch(() => '');
    const json = text ? safeJson(text) : null;
    if (!res.ok) {
      throw new ShipStationApiError(res.status, extractErrorMessage(res.status, json), json);
    }
    return json;
  }

  throw new ShipStationApiError(
    503,
    `ShipStation request failed after ${MAX_RETRIES + 1} attempts${lastErr instanceof Error ? `: ${lastErr.message}` : ''}`,
  );
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

// ─── Request builders (normalized → ShipStation shapes) ─────────────────────

function toSsAddress(a: ShipAddress): Record<string, unknown> {
  return {
    name: a.name,
    phone: a.phone || undefined,
    company_name: a.company || undefined,
    address_line1: a.addressLine1,
    address_line2: a.addressLine2 || undefined,
    city_locality: a.cityLocality,
    state_province: a.stateProvince,
    postal_code: a.postalCode,
    country_code: a.countryCode,
    address_residential_indicator: a.residential == null ? 'unknown' : a.residential ? 'yes' : 'no',
  };
}

function toSsPackages(parcels: Parcel[]): Array<Record<string, unknown>> {
  return parcels.map((p) => ({
    weight: { value: p.weight.value, unit: p.weight.unit },
    ...(p.dimensions
      ? {
          dimensions: {
            unit: p.dimensions.unit,
            length: p.dimensions.length,
            width: p.dimensions.width,
            height: p.dimensions.height,
          },
        }
      : {}),
  }));
}

function toSsShipment(spec: ShipmentSpec, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    validate_address: 'no_validation',
    ship_to: toSsAddress(spec.shipTo),
    ship_from: toSsAddress(spec.shipFrom),
    packages: toSsPackages(spec.parcels),
    confirmation: spec.confirmation ?? 'none',
    ...extra,
  };
}

// ─── Response schemas (permissive — carrier payloads vary) ──────────────────

const MoneySchema = z
  .object({ currency: z.string().nullish(), amount: z.number().nullish() })
  .nullish();

function money(m: z.infer<typeof MoneySchema> | undefined): number {
  return typeof m?.amount === 'number' ? m.amount : 0;
}

const RawRateSchema = z.object({
  rate_id: z.string(),
  carrier_id: z.string().nullish(),
  carrier_code: z.string().nullish(),
  carrier_friendly_name: z.string().nullish(),
  service_type: z.string().nullish(),
  service_code: z.string().nullish(),
  shipping_amount: MoneySchema,
  insurance_amount: MoneySchema,
  confirmation_amount: MoneySchema,
  other_amount: MoneySchema,
  delivery_days: z.number().nullish(),
  carrier_delivery_days: z.string().nullish(),
  estimated_delivery_date: z.string().nullish(),
  package_type: z.string().nullish(),
  trackable: z.boolean().nullish(),
  warning_messages: z.array(z.string()).nullish(),
  error_messages: z.array(z.string()).nullish(),
});

const RateResponseSchema = z.object({
  rate_response: z
    .object({
      rates: z.array(z.unknown()).nullish(),
      invalid_rates: z.array(z.unknown()).nullish(),
      rate_request_id: z.string().nullish(),
      shipment_id: z.string().nullish(),
    })
    .nullish(),
});

function mapRate(raw: z.infer<typeof RawRateSchema>): ShippingRateOption {
  const other =
    money(raw.insurance_amount) + money(raw.confirmation_amount) + money(raw.other_amount);
  return {
    rateId: raw.rate_id,
    carrierId: raw.carrier_id ?? '',
    carrierCode: raw.carrier_code ?? '',
    carrierName: raw.carrier_friendly_name ?? raw.carrier_code ?? 'Carrier',
    serviceCode: raw.service_code ?? '',
    serviceName: raw.service_type ?? raw.service_code ?? 'Service',
    amount: money(raw.shipping_amount),
    currency: raw.shipping_amount?.currency?.toUpperCase() ?? 'USD',
    otherAmount: other > 0 ? other : null,
    deliveryDays: raw.delivery_days ?? null,
    estimatedDeliveryDate: raw.estimated_delivery_date ?? null,
    carrierDeliveryDays: raw.carrier_delivery_days ?? null,
    packageType: raw.package_type ?? null,
    trackable: raw.trackable ?? undefined,
    warnings: raw.warning_messages ?? undefined,
  };
}

const RawLabelSchema = z.object({
  label_id: z.string(),
  status: z.string().nullish(),
  shipment_id: z.string().nullish(),
  ship_date: z.string().nullish(),
  shipment_cost: MoneySchema,
  insurance_cost: MoneySchema,
  tracking_number: z.string(),
  carrier_id: z.string().nullish(),
  carrier_code: z.string().nullish(),
  service_code: z.string().nullish(),
  voided: z.boolean().nullish(),
  label_download: z
    .object({
      href: z.string().nullish(),
      pdf: z.string().nullish(),
      png: z.string().nullish(),
      zpl: z.string().nullish(),
    })
    .nullish(),
});

function mapLabel(raw: z.infer<typeof RawLabelSchema>): LabelPurchaseResult {
  return {
    labelId: raw.label_id,
    status: raw.status ?? 'completed',
    engineShipmentId: raw.shipment_id ?? null,
    trackingNumber: raw.tracking_number,
    carrierCode: raw.carrier_code ?? '',
    carrierId: raw.carrier_id ?? null,
    serviceCode: raw.service_code ?? null,
    shipDate: raw.ship_date ?? null,
    cost: money(raw.shipment_cost) + money(raw.insurance_cost),
    currency: raw.shipment_cost?.currency?.toUpperCase() ?? 'USD',
    labelDownload: {
      pdf: raw.label_download?.pdf ?? null,
      png: raw.label_download?.png ?? null,
      zpl: raw.label_download?.zpl ?? null,
      href: raw.label_download?.href ?? null,
    },
  };
}

export interface LabelPurchaseOptions {
  /** pdf (default) | png | zpl. Slips print with pdf; thermal benches use zpl. */
  labelFormat?: 'pdf' | 'png' | 'zpl';
  /** 4x6 (thermal, default) | letter. */
  labelLayout?: '4x6' | 'letter';
}

// ─── Client ─────────────────────────────────────────────────────────────────

export interface ShipStationV2Client {
  listCarriers(): Promise<EngineCarrier[]>;
  getRates(spec: ShipmentSpec): Promise<RateQuoteResult>;
  purchaseLabelFromRate(rateId: string, opts?: LabelPurchaseOptions): Promise<LabelPurchaseResult>;
  purchaseLabelFromShipment(
    spec: ShipmentSpec,
    carrierId: string,
    serviceCode: string,
    opts?: LabelPurchaseOptions,
  ): Promise<LabelPurchaseResult>;
  voidLabel(labelId: string): Promise<{ approved: boolean; message?: string | null }>;
}

export function createShipStationV2Client(
  apiKey: string,
  baseUrl: string = DEFAULT_BASE_URL,
): ShipStationV2Client {
  const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
    ssFetch(apiKey, baseUrl, method, path, body);

  const listCarriers = async (): Promise<EngineCarrier[]> => {
    const json = (await req('GET', '/carriers')) as { carriers?: unknown[] } | null;
    const carriers = Array.isArray(json?.carriers) ? json!.carriers : [];
    return carriers
      .map((c) => {
        const raw = c as {
          carrier_id?: string;
          carrier_code?: string;
          friendly_name?: string;
          nickname?: string;
          services?: Array<{ service_code?: string; name?: string }>;
        };
        if (!raw.carrier_id) return null;
        return {
          carrierId: raw.carrier_id,
          carrierCode: raw.carrier_code ?? '',
          friendlyName: raw.friendly_name ?? raw.nickname ?? raw.carrier_code ?? 'Carrier',
          services: (raw.services ?? [])
            .filter((s) => s.service_code)
            .map((s) => ({ serviceCode: s.service_code as string, name: s.name ?? s.service_code as string })),
        } satisfies EngineCarrier;
      })
      .filter((c): c is EngineCarrier => c !== null);
  };

  const getRates = async (spec: ShipmentSpec): Promise<RateQuoteResult> => {
    let carrierIds = spec.carrierIds;
    if (!carrierIds || carrierIds.length === 0) {
      carrierIds = (await listCarriers()).map((c) => c.carrierId);
    }
    if (carrierIds.length === 0) {
      throw new ShipStationApiError(400, 'No carriers are connected in your ShipStation account.');
    }

    const json = await req('POST', '/rates', {
      rate_options: { carrier_ids: carrierIds },
      shipment: toSsShipment(spec),
    });
    const parsed = RateResponseSchema.safeParse(json);
    const rr = parsed.success ? parsed.data.rate_response : null;

    const rates: ShippingRateOption[] = [];
    for (const r of rr?.rates ?? []) {
      const rate = RawRateSchema.safeParse(r);
      if (!rate.success) continue;
      // Skip rates the carrier flagged as errored or that priced to zero.
      if (rate.data.error_messages && rate.data.error_messages.length > 0) continue;
      const mapped = mapRate(rate.data);
      if (mapped.amount > 0) rates.push(mapped);
    }
    rates.sort((a, b) => a.amount - b.amount);

    const invalidRates = (rr?.invalid_rates ?? []).map((ir) => {
      const raw = ir as { carrier_code?: string; service_code?: string; error_messages?: string[] };
      return {
        carrierCode: raw.carrier_code ?? null,
        serviceCode: raw.service_code ?? null,
        message: (raw.error_messages ?? []).join('; ') || 'Rate unavailable',
      };
    });

    return {
      rates,
      invalidRates,
      rateRequestId: rr?.rate_request_id ?? null,
      engineShipmentId: rr?.shipment_id ?? null,
    };
  };

  const purchaseLabelFromRate = async (
    rateId: string,
    opts?: LabelPurchaseOptions,
  ): Promise<LabelPurchaseResult> => {
    const json = await req('POST', `/labels/rates/${encodeURIComponent(rateId)}`, {
      label_format: opts?.labelFormat ?? 'pdf',
      label_layout: opts?.labelLayout ?? '4x6',
      label_download_type: 'url',
    });
    return mapLabel(RawLabelSchema.parse(json));
  };

  const purchaseLabelFromShipment = async (
    spec: ShipmentSpec,
    carrierId: string,
    serviceCode: string,
    opts?: LabelPurchaseOptions,
  ): Promise<LabelPurchaseResult> => {
    const json = await req('POST', '/labels', {
      shipment: toSsShipment(spec, { carrier_id: carrierId, service_code: serviceCode }),
      label_format: opts?.labelFormat ?? 'pdf',
      label_layout: opts?.labelLayout ?? '4x6',
      label_download_type: 'url',
    });
    return mapLabel(RawLabelSchema.parse(json));
  };

  const voidLabel = async (labelId: string): Promise<{ approved: boolean; message?: string | null }> => {
    const json = (await req('PUT', `/labels/${encodeURIComponent(labelId)}/void`)) as {
      approved?: boolean;
      message?: string;
    } | null;
    return { approved: Boolean(json?.approved), message: json?.message ?? null };
  };

  return { listCarriers, getRates, purchaseLabelFromRate, purchaseLabelFromShipment, voidLabel };
}

/**
 * Download a purchased label's bytes. v2 label URLs are public (a unique token
 * is embedded in the path) so no API key is required — but we pass it anyway in
 * case the download host ever gates it. Returns raw bytes + content type for the
 * document store (storeOutboundDocumentFromBytes).
 */
export async function downloadLabelBytes(
  url: string,
  apiKey?: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: apiKey ? { 'API-Key': apiKey } : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new ShipStationApiError(res.status, `Label download failed (${res.status})`);
    }
    const contentType = res.headers.get('content-type') || inferContentType(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, contentType };
  } finally {
    clearTimeout(timer);
  }
}

function inferContentType(url: string): string {
  if (/\.png(\?|$)/i.test(url)) return 'image/png';
  if (/\.zpl(\?|$)/i.test(url)) return 'application/zpl';
  return 'application/pdf';
}
