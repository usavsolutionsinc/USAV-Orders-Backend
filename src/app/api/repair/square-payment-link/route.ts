import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getRepairById } from '@/lib/neon/repair-service-queries';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';
import { formatPSTTimestamp } from '@/utils/date';
import { formatSku } from '@/utils/sku';

const SQUARE_PRODUCTION_BASE_URL = 'https://connect.squareup.com/v2';
const SQUARE_SANDBOX_BASE_URL = 'https://connect.squareupsandbox.com/v2';
const DEFAULT_SQUARE_SKU_CACHE_TTL_MS = 1000 * 60 * 3;

interface SquareError {
  code?: string;
  detail?: string;
  field?: string;
}

interface SquareCatalogObject {
  id: string;
  type: 'ITEM' | 'ITEM_VARIATION' | string;
  item_variation_data?: {
    sku?: string;
  };
}

interface SquareCatalogListResponse {
  objects?: SquareCatalogObject[];
  cursor?: string;
  errors?: SquareError[];
}

interface SquarePaymentLinkResponse {
  payment_link?: {
    id?: string;
    order_id?: string;
    url?: string;
    checkout_page_url?: string;
  };
  errors?: SquareError[];
}

let squareVariationSkuCache: {
  updatedAtMs: number;
  bySku: Map<string, string>;
} | null = null;

function requiredEnvAny(primaryName: string, aliases: string[] = []): string {
  for (const key of [primaryName, ...aliases]) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  throw new Error(`Missing required environment variable: ${primaryName}`);
}

function resolveSquareBaseUrl(): string {
  const explicit = process.env.SQUARE_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const env = (process.env.SQUARE_ENVIRONMENT || '').trim().toUpperCase();
  if (env === 'SANDBOX') return SQUARE_SANDBOX_BASE_URL;

  return SQUARE_PRODUCTION_BASE_URL;
}

function parsePriceToMinorUnits(value: string | null | undefined): number | null {
  const cleaned = String(value || '').replace(/[^0-9.-]/g, '');
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  const amount = Math.round(parsed * 100);
  return amount > 0 ? amount : null;
}

function parseSkuCandidate(value: string | null | undefined): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const first = raw
    .split(/[\n,;|]/)
    .map((part) => part.trim())
    .find(Boolean);

  if (!first) return null;
  const cleaned = first.replace(/^SKU[:#\s-]*/i, '').trim();
  return cleaned || null;
}

function extractSkuFromRepairNotes(value: string | null | undefined): string | null {
  const notes = String(value || '');
  if (!notes) return null;

  const match = notes.match(/Source SKU:\s*([^\n\r]+)/i);
  if (!match?.[1]) return null;

  return parseSkuCandidate(match[1]);
}

function resolveRepairSku(
  repair: { source_sku?: string | null; notes?: string | null },
  requestedSku: unknown
): string | null {
  const candidates = [
    parseSkuCandidate(String(requestedSku || '')),
    parseSkuCandidate(repair.source_sku),
    extractSkuFromRepairNotes(repair.notes),
  ];

  for (const candidate of candidates) {
    if (candidate) return candidate;
  }

  return null;
}

function parseContactInfo(value: string | null | undefined): {
  name: string | null;
  phone: string | null;
  email: string | null;
} {
  const parts = String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  const name = parts[0] || null;
  const phone = parts[1] || null;
  const email = parts.find((part) => part.includes('@')) || null;

  return { name, phone, email };
}

function formatSquareErrors(errors: SquareError[] | undefined): string {
  if (!Array.isArray(errors) || errors.length === 0) return 'Square API request failed';
  return errors
    .map((error) => [error.code, error.detail, error.field].filter(Boolean).join(' | '))
    .filter(Boolean)
    .join('; ');
}

function resolveSquareSkuCacheTtlMs(): number {
  const raw = Number(process.env.SQUARE_SKU_CACHE_TTL_MS || '');
  if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  return DEFAULT_SQUARE_SKU_CACHE_TTL_MS;
}

async function buildSquareVariationSkuIndex(
  squareBaseUrl: string,
  squareAccessToken: string,
  squareVersion: string
): Promise<Map<string, string>> {
  const bySku = new Map<string, string>();
  let cursor: string | undefined;

  while (true) {
    const url = new URL(`${squareBaseUrl}/catalog/list`);
    url.searchParams.set('types', 'ITEM_VARIATION');
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${squareAccessToken}`,
        'Square-Version': squareVersion,
        'Content-Type': 'application/json',
      },
    });

    const payload = (await response.json().catch(() => ({}))) as SquareCatalogListResponse;
    if (!response.ok) {
      const details = formatSquareErrors(payload.errors);
      throw new Error(`Square catalog lookup failed (${response.status}): ${details}`);
    }

    const objects = Array.isArray(payload.objects) ? payload.objects : [];
    for (const object of objects) {
      if (object.type !== 'ITEM_VARIATION') continue;
      const normalizedSku = formatSku(String(object.item_variation_data?.sku || ''));
      if (!normalizedSku) continue;
      if (!bySku.has(normalizedSku)) {
        bySku.set(normalizedSku, object.id);
      }
    }

    if (!payload.cursor) break;
    cursor = payload.cursor;
  }

  return bySku;
}

async function getSquareVariationIdBySku(
  squareBaseUrl: string,
  squareAccessToken: string,
  squareVersion: string,
  sku: string
): Promise<string | null> {
  const normalizedSku = formatSku(String(sku || ''));
  if (!normalizedSku) return null;

  const cacheTtlMs = resolveSquareSkuCacheTtlMs();
  const now = Date.now();
  const cacheIsFresh =
    squareVariationSkuCache &&
    now - squareVariationSkuCache.updatedAtMs <= cacheTtlMs;

  if (cacheIsFresh && squareVariationSkuCache) {
    const cachedMatch = squareVariationSkuCache.bySku.get(normalizedSku);
    if (cachedMatch) return cachedMatch;
  }

  const refreshed = await buildSquareVariationSkuIndex(
    squareBaseUrl,
    squareAccessToken,
    squareVersion
  );

  squareVariationSkuCache = {
    updatedAtMs: now,
    bySku: refreshed,
  };

  return refreshed.get(normalizedSku) || null;
}

export async function POST(req: NextRequest) {
  try {
    if (!isAllowedAdminOrigin(req)) {
      return NextResponse.json(
        { success: false, error: `Origin not allowed: ${req.headers.get('origin')}` },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      repairId?: number | string;
      sourceSku?: string | null;
    };
    const repairId = Number(body?.repairId);

    if (!Number.isInteger(repairId) || repairId <= 0) {
      return NextResponse.json({ success: false, error: 'repairId is required' }, { status: 400 });
    }

    const repair = await getRepairById(repairId);
    if (!repair) {
      return NextResponse.json({ success: false, error: `Repair ${repairId} not found` }, { status: 404 });
    }

    const amount = parsePriceToMinorUnits(repair.price);

    const squareAccessToken = requiredEnvAny('SQUARE_ACCESS_TOKEN', [
      'SQUARE_TOKEN',
      'SQUARE_API_TOKEN',
      'NEXT_PUBLIC_SQUARE_ACCESS_TOKEN',
    ]);
    const squareLocationId = requiredEnvAny('SQUARE_LOCATION_ID', [
      'SQUARE_DEFAULT_LOCATION_ID',
      'NEXT_PUBLIC_SQUARE_LOCATION_ID',
    ]);
    const squareVersion = process.env.SQUARE_VERSION || '2024-01-18';
    const squareCurrency = (process.env.SQUARE_CURRENCY || 'USD').trim().toUpperCase();
    const squareBaseUrl = resolveSquareBaseUrl();
    const checkoutRedirectUrl = process.env.SQUARE_CHECKOUT_REDIRECT_URL?.trim();

    const sourceSku = resolveRepairSku(repair, body?.sourceSku);
    const squareVariationId = sourceSku
      ? await getSquareVariationIdBySku(
          squareBaseUrl,
          squareAccessToken,
          squareVersion,
          sourceSku
        )
      : null;
    const usingSkuCatalogCheckout = Boolean(squareVariationId);

    if (!usingSkuCatalogCheckout && amount === null) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Unable to create payment link. This repair needs a valid source_sku match or a valid repair price.',
        },
        { status: 400 }
      );
    }
    const fallbackAmount = amount ?? 0;

    const { name, phone, email } = parseContactInfo(repair.contact_info);
    const lineItemName = String(repair.product_title || '').trim() || `Repair #${repair.id}`;
    const paymentNoteParts = [
      repair.ticket_number ? `Ticket: ${repair.ticket_number}` : null,
      name ? `Customer: ${name}` : null,
      repair.serial_number ? `Serial: ${repair.serial_number}` : null,
      sourceSku ? `SKU: ${sourceSku}` : null,
    ].filter(Boolean);

    const squareRequestBody: Record<string, unknown> = {
      idempotency_key: `repair-square-link-${repair.id}-${randomUUID()}`,
      payment_note: paymentNoteParts.join(' | ') || `Repair ${repair.id}`,
      checkout_options: {
        allow_tipping: false,
        ask_for_shipping_address: false,
        ...(checkoutRedirectUrl ? { redirect_url: checkoutRedirectUrl } : {}),
      },
      ...(email || phone
        ? {
            pre_populated_data: {
              ...(email ? { buyer_email: email } : {}),
              ...(phone ? { buyer_phone_number: phone } : {}),
            },
          }
        : {}),
    };

    if (usingSkuCatalogCheckout && squareVariationId) {
      squareRequestBody.order = {
        location_id: squareLocationId,
        reference_id: `repair-${repair.id}`,
        line_items: [
          {
            quantity: '1',
            catalog_object_id: squareVariationId,
          },
        ],
      };
    } else {
      squareRequestBody.quick_pay = {
        name: lineItemName,
        location_id: squareLocationId,
        price_money: {
          amount: fallbackAmount,
          currency: squareCurrency,
        },
      };
    }

    const response = await fetch(`${squareBaseUrl}/online-checkout/payment-links`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${squareAccessToken}`,
        'Square-Version': squareVersion,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(squareRequestBody),
    });

    const payload = (await response.json().catch(() => ({}))) as SquarePaymentLinkResponse;
    if (!response.ok) {
      const details = formatSquareErrors(payload.errors);
      return NextResponse.json(
        { success: false, error: `Square CreatePaymentLink failed: ${details}` },
        { status: 502 }
      );
    }

    const paymentUrl = payload?.payment_link?.url || payload?.payment_link?.checkout_page_url || '';
    if (!paymentUrl) {
      return NextResponse.json(
        { success: false, error: 'Square response did not include a checkout URL' },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      paymentUrl,
      squarePaymentLinkId: payload.payment_link?.id || null,
      squareOrderId: payload.payment_link?.order_id || null,
      mode: usingSkuCatalogCheckout ? 'catalog_sku' : 'quick_pay_fallback',
      matchedSku: usingSkuCatalogCheckout ? sourceSku : null,
      repairId,
      timestamp: formatPSTTimestamp(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Repair Square payment link error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
