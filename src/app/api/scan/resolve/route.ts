import { NextRequest, NextResponse } from 'next/server';
import {
  classifyInput,
  parseScannedUrl,
  parseGs1AiPayload,
  pickAiRoutingValue,
  type ScannedUrlEntity,
  type Gs1AiTree,
} from '@/lib/scan-resolver';
import { routeScan } from '@/lib/barcode-routing';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';
import { query, queryOne } from '@/lib/neon-client';
import { withAuth } from '@/lib/auth/withAuth';
import { publishScanLog } from '@/lib/realtime/publish';

/**
 * GET|POST /api/scan/resolve
 *
 * Universal scanner resolver for both desktop and the mobile cockpit
 * (`/m/scan`).
 *
 * Resolution cascade (first match wins):
 *   1. Multi-AI GS1 Data Matrix (FNC1 or parenthesized form)
 *   2. GS1 Digital Link URL or internal /l|/p|/o|/s|/q prefix
 *   3. Pattern classify — tracking | FNSKU | serial_full | serial_partial
 *   4. Fallback: 'unknown'
 *
 * For every scan we additionally look up matching orders (single | multi |
 * none) and return a `mobileRoute` field that /m/scan uses to navigate
 * directly to the order detail page when there is exactly one match.
 *
 * IMPORTANT: This route NEVER writes to receiving_*. It writes only to
 * `mobile_scan_events` for telemetry. The mobile center scan button is
 * intent-routing, not a receiving event.
 */

export const dynamic = 'force-dynamic';

type ResolveKind =
  | 'gs1_unit'
  | 'gs1_lot'
  | 'gs1_product'
  | 'gs1_ai'
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

type MatchOutcome = 'single' | 'multi' | 'none';

interface OrderMatch {
  id: number;
  order_id: string;
  sku: string | null;
  product_title: string | null;
  status: string | null;
  quantity: string | null;
  account_source: string | null;
}

interface ResolveResponse {
  ok: true;
  kind: ResolveKind;
  source: 'ai' | 'url' | 'pattern' | 'none';
  raw: string;
  url?: string;
  ais?: Record<string, string>;
  entity?: Record<string, unknown>;
  redirectTo?: string | null;
  matches: OrderMatch[];
  matchOutcome: MatchOutcome;
  /** Where the mobile cockpit should navigate. NEVER points at /receiving. */
  mobileRoute: string | null;
}

// ─── Order lookups ───────────────────────────────────────────────────────────

async function lookupOrdersByTracking(tracking: string): Promise<OrderMatch[]> {
  const key18 = normalizeTrackingKey18(tracking);
  if (!key18) return [];
  try {
    return await query<OrderMatch>`
      SELECT DISTINCT o.id, o.order_id, o.sku, o.product_title, o.status, o.quantity, o.account_source
      FROM orders o
      JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
      WHERE stn.tracking_number_key18 = ${key18}
      ORDER BY o.id DESC
      LIMIT 20
    `;
  } catch {
    return [];
  }
}

async function lookupOrdersBySerial(serial: string): Promise<OrderMatch[]> {
  const norm = serial.trim().toUpperCase();
  if (!norm) return [];
  try {
    const exact = await query<OrderMatch>`
      SELECT DISTINCT o.id, o.order_id, o.sku, o.product_title, o.status, o.quantity, o.account_source
      FROM orders o
      JOIN tech_serial_numbers tsn ON tsn.shipment_id = o.shipment_id
      WHERE UPPER(tsn.serial_number) = ${norm}
      ORDER BY o.id DESC
      LIMIT 20
    `;
    if (exact.length) return exact;

    if (norm.length >= 4) {
      const suffix = await query<OrderMatch>`
        SELECT DISTINCT o.id, o.order_id, o.sku, o.product_title, o.status, o.quantity, o.account_source
        FROM orders o
        JOIN tech_serial_numbers tsn ON tsn.shipment_id = o.shipment_id
        WHERE UPPER(tsn.serial_number) LIKE ${'%' + norm}
        ORDER BY o.id DESC
        LIMIT 20
      `;
      if (suffix.length) return suffix;
    }

    if (norm.length >= 3 && norm.length <= 10) {
      return await query<OrderMatch>`
        SELECT DISTINCT o.id, o.order_id, o.sku, o.product_title, o.status, o.quantity, o.account_source
        FROM orders o
        JOIN tech_serial_numbers tsn ON tsn.shipment_id = o.shipment_id
        WHERE UPPER(tsn.serial_number) LIKE ${'%' + norm + '%'}
        ORDER BY o.id DESC
        LIMIT 20
      `;
    }
    return [];
  } catch {
    return [];
  }
}

async function lookupOrderById(orderId: string): Promise<OrderMatch[]> {
  const trimmed = orderId.trim();
  if (!trimmed) return [];
  try {
    return await query<OrderMatch>`
      SELECT o.id, o.order_id, o.sku, o.product_title, o.status, o.quantity, o.account_source
      FROM orders o
      WHERE o.order_id = ${trimmed}
      LIMIT 5
    `;
  } catch {
    return [];
  }
}

// ─── Receiving lookups ───────────────────────────────────────────────────────
//
// Receiving labels print a Data Matrix carrying `R-{id}` (the bare handle).
// Workers also frequently scan or type the plain PO number. Both should
// land on the carton detail page `/m/r/{receiving_id}` so tech can mark the
// tested-pass / tested-fail outcome.

async function lookupReceivingByPoNumber(po: string): Promise<{ id: number; zoho_purchaseorder_number: string | null } | null> {
  const trimmed = po.trim();
  if (!trimmed) return null;
  try {
    return await queryOne<{ id: number; zoho_purchaseorder_number: string | null }>`
      SELECT id, zoho_purchaseorder_number
      FROM receiving
      WHERE zoho_purchaseorder_number = ${trimmed}
         OR zoho_purchaseorder_id = ${trimmed}
      ORDER BY id DESC
      LIMIT 1
    `;
  } catch {
    return null;
  }
}

async function lookupOrdersBySku(sku: string): Promise<OrderMatch[]> {
  const trimmed = sku.trim();
  if (!trimmed) return [];
  try {
    return await query<OrderMatch>`
      SELECT o.id, o.order_id, o.sku, o.product_title, o.status, o.quantity, o.account_source
      FROM orders o
      WHERE o.sku = ${trimmed}
        AND (o.status IS NULL OR o.status NOT IN ('shipped', 'cancelled', 'closed'))
      ORDER BY o.id DESC
      LIMIT 20
    `;
  } catch {
    return [];
  }
}

// ─── URL helper enrichment ───────────────────────────────────────────────────

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

// ─── Telemetry ───────────────────────────────────────────────────────────────

interface LogParams {
  staffId: number;
  raw: string;
  normalized: string | null;
  kind: ResolveKind;
  carrier: string | null;
  matches: OrderMatch[];
  outcome: MatchOutcome;
  routedTo: string | null;
  parsedAis: Record<string, string> | null;
  device: unknown;
}

async function logScanEvent(p: LogParams): Promise<void> {
  try {
    await query`
      INSERT INTO mobile_scan_events (
        staff_id, raw_value, normalized, kind, carrier,
        matched_order_id, match_outcome, routed_to, parsed_ais, device_info
      )
      VALUES (
        ${p.staffId},
        ${p.raw},
        ${p.normalized},
        ${p.kind},
        ${p.carrier},
        ${p.matches.length === 1 ? p.matches[0].order_id : null},
        ${p.outcome},
        ${p.routedTo},
        ${p.parsedAis ? JSON.stringify(p.parsedAis) : null}::jsonb,
        ${p.device ? JSON.stringify(p.device) : null}::jsonb
      )
    `;
  } catch {
    // Telemetry must never break the resolver.
  }
}

// ─── Mobile route picker ─────────────────────────────────────────────────────
//
// NEVER returns a `/receiving` route. The mobile center button is not a
// receiving entry point. When we can't resolve to a single order we return
// null and let the client show fallback affordances.

function pickMobileRoute(matches: OrderMatch[]): string | null {
  if (matches.length === 1) {
    return `/m/orders/${encodeURIComponent(matches[0].order_id)}`;
  }
  return null;
}

async function matchesForUrlEntity(entity: ScannedUrlEntity): Promise<OrderMatch[]> {
  switch (entity.type) {
    case 'order':
      return lookupOrderById(entity.orderId);
    case 'package':
      return lookupOrdersByTracking(entity.trackingNumber);
    case 'unit':
      return lookupOrdersBySerial(entity.unitSerial);
    case 'stock':
      return lookupOrdersBySku(entity.sku);
    case 'gs1_product': {
      const sku = await resolveSkuByGtin(entity.gtin);
      return sku ? lookupOrdersBySku(sku) : [];
    }
    default:
      return [];
  }
}

async function matchesForAiTree(tree: Gs1AiTree): Promise<OrderMatch[]> {
  const pick = pickAiRoutingValue(tree);
  if (!pick) return [];
  switch (pick.kind) {
    case 'serial':
      return lookupOrdersBySerial(pick.value);
    case 'tracking':
      return lookupOrdersByTracking(pick.value);
    case 'gtin': {
      const sku = await resolveSkuByGtin(pick.value);
      return sku ? lookupOrdersBySku(sku) : [];
    }
    default:
      return [];
  }
}

// ─── Main resolve flow ───────────────────────────────────────────────────────

async function resolve(input: string, staffId: number, device: unknown): Promise<ResolveResponse> {
  const trimmed = String(input ?? '').trim();
  const base = {
    ok: true as const,
    raw: trimmed,
    matches: [] as OrderMatch[],
    matchOutcome: 'none' as MatchOutcome,
    mobileRoute: null as string | null,
  };

  if (!trimmed) return { ...base, kind: 'unknown', source: 'none' };

  // 0. Internal receiving handles — `R-{id}`, `L-{id}`, `U-{id}`, `REP-{id}`,
  //    and the URL forms of the same. These are what the receiving station
  //    actually prints onto carton/line labels (see `printReceivingLabel`).
  //    They route DIRECTLY to the existing /m/r, /m/l, /m/u, /repair pages
  //    without touching `mobile_scan_events`-style classification.
  const handleRoute = routeScan(trimmed);
  if (handleRoute && handleRoute.redirect && (
    handleRoute.type === 'receiving' ||
    handleRoute.type === 'receiving-line' ||
    handleRoute.type === 'serial-unit' ||
    handleRoute.type === 'handling-unit'
  )) {
    // A handling unit (box/LPN) is a physical container, so it shares the
    // `package` kind; only a unit handle resolves to a single unit.
    const kind: ResolveKind = handleRoute.type === 'serial-unit'
      ? 'gs1_unit'
      : 'package';
    const result: ResolveResponse = {
      ...base,
      kind,
      source: 'pattern',
      entity: { handleType: handleRoute.type, redirect: handleRoute.redirect },
      matches: [],
      matchOutcome: 'single',
      mobileRoute: handleRoute.redirect,
    };
    await logScanEvent({
      staffId, raw: trimmed, normalized: null, kind, carrier: null,
      matches: [], outcome: 'single', routedTo: handleRoute.redirect,
      parsedAis: null, device,
    });
    // Push the receiving scan to the signed-in staff's desktop phone-history
    // popover (scanlog:{staffId}). Read-only history feed — never touches
    // receiving_* or the receiving-station `phone:{staffId}` bridge.
    void publishScanLog({
      staffId, rawValue: trimmed, kind, routedTo: handleRoute.redirect,
    });
    return result;
  }

  // 0b. Plain PO number (no `R-` prefix) — look it up in `receiving` and
  //     route to the same /m/r page.
  if (/^[A-Z0-9][A-Z0-9_\-]{2,}$/i.test(trimmed)) {
    const po = await lookupReceivingByPoNumber(trimmed);
    if (po) {
      const route = `/m/r/${po.id}`;
      const result: ResolveResponse = {
        ...base,
        kind: 'package',
        source: 'pattern',
        entity: { receivingId: po.id, po: po.zoho_purchaseorder_number },
        matches: [],
        matchOutcome: 'single',
        mobileRoute: route,
      };
      await logScanEvent({
        staffId, raw: trimmed, normalized: trimmed.toUpperCase(), kind: 'package',
        carrier: null, matches: [], outcome: 'single', routedTo: route,
        parsedAis: null, device,
      });
      void publishScanLog({ staffId, rawValue: trimmed, kind: 'package', routedTo: route });
      return result;
    }
  }

  // 1. Multi-AI GS1 Data Matrix.
  const aiTree = parseGs1AiPayload(trimmed);
  if (aiTree) {
    const matches = await matchesForAiTree(aiTree);
    const outcome: MatchOutcome = matches.length === 0 ? 'none' : matches.length === 1 ? 'single' : 'multi';
    const mobileRoute = pickMobileRoute(matches);
    const result: ResolveResponse = {
      ...base, kind: 'gs1_ai', source: 'ai', ais: aiTree.ais,
      entity: { ais: aiTree.ais }, matches, matchOutcome: outcome, mobileRoute,
    };
    await logScanEvent({
      staffId, raw: trimmed, normalized: null, kind: 'gs1_ai', carrier: null,
      matches, outcome, routedTo: mobileRoute, parsedAis: aiTree.ais, device,
    });
    return result;
  }

  // 2. URL branch.
  const urlEntity = parseScannedUrl(trimmed);
  if (urlEntity) {
    const matches = await matchesForUrlEntity(urlEntity);
    const outcome: MatchOutcome = matches.length === 0 ? 'none' : matches.length === 1 ? 'single' : 'multi';
    const mobileRoute = pickMobileRoute(matches);
    const kind: ResolveKind = (() => {
      switch (urlEntity.type) {
        case 'unit': return 'gs1_unit';
        case 'gs1_lot': return 'gs1_lot';
        case 'gs1_product': return 'gs1_product';
        case 'location': return 'location';
        case 'package': return 'package';
        case 'order': return 'order';
        case 'stock': return 'stock';
        case 'generic': return 'generic';
      }
    })();
    const result: ResolveResponse = {
      ...base, kind, source: 'url', url: urlEntity.url,
      entity: urlEntity as unknown as Record<string, unknown>,
      matches, matchOutcome: outcome, mobileRoute,
    };
    await logScanEvent({
      staffId, raw: trimmed, normalized: null, kind, carrier: null,
      matches, outcome, routedTo: mobileRoute, parsedAis: null, device,
    });
    return result;
  }

  // 3. Pattern classify branch.
  const classified = classifyInput(trimmed);
  let matches: OrderMatch[] = [];
  if (classified.type === 'tracking') {
    matches = await lookupOrdersByTracking(classified.normalized);
  } else if (classified.type === 'serial_full' || classified.type === 'serial_partial') {
    matches = await lookupOrdersBySerial(classified.normalized);
  } else {
    matches = await lookupOrderById(trimmed);
    if (!matches.length) matches = await lookupOrdersBySku(trimmed);
  }

  const outcome: MatchOutcome = matches.length === 0 ? 'none' : matches.length === 1 ? 'single' : 'multi';
  const mobileRoute = pickMobileRoute(matches);
  const kind: ResolveKind = classified.type === 'tracking'
    ? 'tracking'
    : (classified.type as ResolveKind);
  const result: ResolveResponse = {
    ...base, kind, source: 'pattern',
    entity: { normalized: classified.normalized, carrier: classified.carrier },
    matches, matchOutcome: outcome, mobileRoute,
  };
  await logScanEvent({
    staffId, raw: trimmed, normalized: classified.normalized, kind,
    carrier: classified.carrier, matches, outcome, routedTo: mobileRoute,
    parsedAis: null, device,
  });
  return result;
}

export const GET = withAuth(async (request: NextRequest, ctx) => {
  const input = request.nextUrl.searchParams.get('input') ?? '';
  const result = await resolve(input, ctx.staffId, null);
  return NextResponse.json(result);
}, { permission: 'sku_stock.view' });

export const POST = withAuth(async (request: NextRequest, ctx) => {
  const body = await request.json().catch(() => ({}));
  const input = typeof body?.input === 'string' ? body.input : '';
  const result = await resolve(input, ctx.staffId, body?.device ?? null);
  return NextResponse.json(result);
}, { permission: 'sku_stock.view' });
