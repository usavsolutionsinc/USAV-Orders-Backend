import { NextRequest, NextResponse } from 'next/server';
import { classifyInput, parseScannedUrl } from '@/lib/scan-resolver';
import type { ScannedUrlEntity } from '@/lib/scan-resolver';
import { queryOne } from '@/lib/neon-client';

/**
 * GET|POST /api/scan/resolve
 *
 * Single source of truth for the warehouse-app scanner. Accepts either
 *   ?input=...  (GET query string)
 *   { input: ... } (POST JSON body)
 * and returns a typed entity descriptor PLUS minimal entity data so the
 * scanner UI can route to the right screen without a second roundtrip.
 *
 * Resolution order:
 *   1. URL parse — GS1 Digital Link or internal /l|/p|/o|/s|/q prefix
 *   2. Pattern classify — tracking | FNSKU | serial_full | serial_partial
 *   3. Fallback: 'unknown' with the normalized form
 *
 * Phase 1 returns identifiers only (no joins). Subsequent phases will
 * enrich each entity with current state, location, allowed actions.
 */

export const dynamic = 'force-dynamic';

interface ResolveSuccess {
  ok: true;
  /** Stable kind that the UI can switch on. */
  kind:
    | 'gs1_unit'
    | 'gs1_lot'
    | 'gs1_product'
    | 'location'
    | 'package'
    | 'order'
    | 'stock'
    | 'tracking'
    | 'fnsku'
    | 'serial_full'
    | 'serial_partial'
    | 'generic'
    | 'unknown';
  source: 'url' | 'pattern' | 'none';
  raw: string;
  url?: string;
  entity?: Record<string, unknown>;
  /** Hint for which app section the UI should route to. May be null. */
  redirectTo?: string | null;
}

async function resolveUnit(unitSerial: string): Promise<{ id: number; sku: string | null } | null> {
  try {
    return await queryOne<{ id: number; sku: string | null }>`
      SELECT id, sku FROM serial_units
      WHERE normalized_serial = UPPER(TRIM(${unitSerial}))
      LIMIT 1
    `;
  } catch {
    return null;
  }
}

async function resolveSkuByGtin(gtin: string): Promise<string | null> {
  try {
    const cleaned = gtin.replace(/\D/g, '');
    if (!cleaned) return null;
    const row = await queryOne<{ sku: string | null }>`
      SELECT sku FROM sku_catalog WHERE gtin = ${cleaned} LIMIT 1
    `;
    return row?.sku ?? null;
  } catch {
    return null;
  }
}

async function resolveLocation(ref: string): Promise<{ id: number; barcode: string | null; name: string | null } | null> {
  try {
    return await queryOne<{ id: number; barcode: string | null; name: string | null }>`
      SELECT id, barcode, name FROM locations
      WHERE barcode = ${ref} OR name = ${ref}
      LIMIT 1
    `;
  } catch {
    return null;
  }
}

async function enrichUrl(entity: ScannedUrlEntity): Promise<ResolveSuccess> {
  const base: Omit<ResolveSuccess, 'kind' | 'entity' | 'redirectTo'> = {
    ok: true,
    source: 'url',
    raw: entity.url,
    url: entity.url,
  };

  switch (entity.type) {
    case 'unit': {
      const unit = await resolveUnit(entity.unitSerial);
      return {
        ...base,
        kind: 'gs1_unit',
        entity: {
          gtin: entity.gtin,
          unitSerial: entity.unitSerial,
          serialUnitId: unit?.id ?? null,
          sku: unit?.sku ?? null,
        },
        redirectTo: unit ? `/sku-stock/${encodeURIComponent(unit.sku ?? '')}` : null,
      };
    }
    case 'gs1_product': {
      const sku = await resolveSkuByGtin(entity.gtin);
      return {
        ...base,
        kind: 'gs1_product',
        entity: { gtin: entity.gtin, sku },
        redirectTo: sku ? `/sku-stock/${encodeURIComponent(sku)}` : '/sku-stock',
      };
    }
    case 'gs1_lot':
      return {
        ...base,
        kind: 'gs1_lot',
        entity: { gtin: entity.gtin, lot: entity.lot },
        redirectTo: null,
      };
    case 'location': {
      const loc = await resolveLocation(entity.locationRef);
      return {
        ...base,
        kind: 'location',
        entity: { ref: entity.locationRef, locationId: loc?.id ?? null, barcode: loc?.barcode ?? null, name: loc?.name ?? null },
        redirectTo: loc?.barcode ? `/sku-stock/location/${encodeURIComponent(loc.barcode)}` : null,
      };
    }
    case 'package':
      return {
        ...base,
        kind: 'package',
        entity: { trackingNumber: entity.trackingNumber },
        redirectTo: null,
      };
    case 'order':
      return {
        ...base,
        kind: 'order',
        entity: { orderId: entity.orderId },
        redirectTo: null,
      };
    case 'stock':
      return {
        ...base,
        kind: 'stock',
        entity: { sku: entity.sku },
        redirectTo: `/sku-stock/${encodeURIComponent(entity.sku)}`,
      };
    case 'generic':
      return {
        ...base,
        kind: 'generic',
        entity: { payload: entity.payload },
        redirectTo: null,
      };
  }
}

async function resolve(input: string): Promise<ResolveSuccess> {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) {
    return { ok: true, kind: 'unknown', source: 'none', raw: '' };
  }

  // 1. URL branch (additive — never throws on non-URLs).
  const urlEntity = parseScannedUrl(trimmed);
  if (urlEntity) return enrichUrl(urlEntity);

  // 2. Legacy pattern branch.
  const classified = classifyInput(trimmed);
  return {
    ok: true,
    kind: classified.type === 'tracking' ? 'tracking' : (classified.type as ResolveSuccess['kind']),
    source: 'pattern',
    raw: trimmed,
    entity: {
      normalized: classified.normalized,
      carrier: classified.carrier,
    },
    redirectTo: null,
  };
}

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get('input') ?? '';
  const result = await resolve(input);
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const input = typeof body?.input === 'string' ? body.input : '';
  const result = await resolve(input);
  return NextResponse.json(result);
}
