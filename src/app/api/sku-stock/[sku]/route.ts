import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getActiveLocations, logLocationTransfer, getTransfersForSku } from '@/lib/neon/location-queries';
import { recordInventoryEvent } from '@/lib/inventory/events';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import {
  assertPermission,
  PermissionDeniedError,
  permissionDeniedResponse,
} from '@/lib/auth/permissions';
import { SkuStockPatchBody } from '@/lib/schemas/locations';
import { parseBody } from '@/lib/schemas/parse';

const ROUTE_SKU_STOCK_PATCH = 'sku-stock.sku.patch';

const ECWID_BASE_URL = 'https://app.ecwid.com/api/v3';

function envAny(primary: string, aliases: string[] = []): string | null {
  for (const key of [primary, ...aliases]) {
    const v = process.env[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

// ─── GET /api/sku-stock/[sku] — aggregated SKU detail ────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sku: string }> },
) {
  const { sku } = await params;
  const skuValue = decodeURIComponent(sku).trim();

  if (!skuValue) {
    return NextResponse.json({ error: 'SKU is required' }, { status: 400 });
  }

  try {
    // Run all queries in parallel
    const [stockResult, historyResult, catalogResult, photosResult, ledgerResult, allLocations, transfers] =
      await Promise.all([
        // 1. sku_stock row
        pool.query(
          `SELECT id, sku, product_title, stock FROM sku_stock WHERE sku = $1 LIMIT 1`,
          [skuValue],
        ),
        // 2. sku history rows (inventory log entries for this static_sku)
        pool.query(
          `SELECT id, static_sku, serial_number, shipping_tracking_number, notes, location, created_at, updated_at
           FROM v_sku
           WHERE static_sku = $1
           ORDER BY id DESC
           LIMIT 50`,
          [skuValue],
        ),
        // 3. sku_catalog entry
        pool.query(
          `SELECT id, sku, product_title, category, upc, ean, image_url, is_active
           FROM sku_catalog WHERE sku = $1 LIMIT 1`,
          [skuValue],
        ),
        // 4. Photos for SKU records with this static_sku
        pool.query(
          `SELECT p.id, p.entity_id AS sku_id, p.url, p.photo_type, p.taken_by_staff_id, p.created_at
           FROM photos p
           JOIN sku s ON s.id = p.entity_id
           WHERE p.entity_type = 'SKU' AND s.static_sku = $1
           ORDER BY p.created_at DESC`,
          [skuValue],
        ),
        // 5. Stock ledger (audit trail)
        pool.query(
          `SELECT id, sku, delta, reason, staff_id, created_at
           FROM sku_stock_ledger
           WHERE sku = $1
           ORDER BY created_at DESC
           LIMIT 25`,
          [skuValue],
        ).catch(() => ({ rows: [] })), // table may not exist yet
        // 6. All defined locations
        getActiveLocations().catch(() => []),
        // 7. Location transfer history for this SKU
        getTransfersForSku(skuValue).catch(() => []),
      ]);

    const stock = stockResult.rows[0] ?? null;
    const history = historyResult.rows;
    const catalog = catalogResult.rows[0] ?? null;
    const photos = photosResult.rows;
    const ledger = ledgerResult.rows;

    // 6. Try Ecwid product lookup (non-blocking)
    let ecwid: {
      id: string;
      name: string;
      sku: string;
      price: number | null;
      thumbnailUrl: string | null;
      inStock: boolean;
      description: string | null;
    } | null = null;

    const storeId = envAny('ECWID_STORE_ID', ['ECWID_STOREID', 'ECWID_STORE', 'NEXT_PUBLIC_ECWID_STORE_ID']);
    const token = envAny('ECWID_API_TOKEN', ['ECWID_TOKEN', 'ECWID_ACCESS_TOKEN', 'NEXT_PUBLIC_ECWID_API_TOKEN']);

    if (storeId && token) {
      try {
        const url = new URL(`${ECWID_BASE_URL}/${storeId}/products`);
        url.searchParams.set('keyword', skuValue);
        url.searchParams.set('limit', '5');

        const res = await fetch(url.toString(), {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
        });

        if (res.ok) {
          const data = await res.json();
          const items = Array.isArray(data?.items) ? data.items : [];
          // Find exact SKU match
          const match = items.find(
            (p: any) => String(p.sku || '').trim().toUpperCase() === skuValue.toUpperCase(),
          );
          if (match) {
            ecwid = {
              id: String(match.id),
              name: String(match.name || '').trim(),
              sku: String(match.sku || '').trim(),
              price: typeof match.price === 'number' ? match.price : null,
              thumbnailUrl: match.thumbnailUrl || match.imageUrl || null,
              inStock: match.inStock !== false,
              description: match.description
                ? String(match.description).replace(/<[^>]*>/g, '').slice(0, 500)
                : null,
            };
          }
        }
      } catch {
        // Ecwid lookup is best-effort
      }
    }

    // Derive best available image
    const productImage =
      ecwid?.thumbnailUrl || catalog?.image_url || null;

    // Derive product title from best source
    const productTitle =
      stock?.product_title || catalog?.product_title || ecwid?.name || null;

    // Unique locations from history
    const locations = [
      ...new Set(history.map((r: any) => r.location).filter(Boolean)),
    ] as string[];

    return NextResponse.json({
      sku: skuValue,
      productTitle,
      productImage,
      stock: stock
        ? { id: stock.id, qty: Number(stock.stock) || 0 }
        : { id: null, qty: 0 },
      catalog: catalog
        ? {
            id: catalog.id,
            category: catalog.category,
            upc: catalog.upc,
            ean: catalog.ean,
            imageUrl: catalog.image_url,
            isActive: catalog.is_active,
          }
        : null,
      ecwid,
      history,
      photos: photos.map((p: any) => ({
        id: p.id,
        skuId: p.sku_id,
        url: p.url,
        photoType: p.photo_type,
        takenByStaffId: p.taken_by_staff_id,
        createdAt: p.created_at,
      })),
      ledger,
      locations,
      allLocations,
      transfers,
    });
  } catch (err: any) {
    console.error('[GET /api/sku-stock/[sku]] error:', err);
    return NextResponse.json(
      { error: 'Failed to load SKU detail', details: err?.message },
      { status: 500 },
    );
  }
}

// ─── PATCH /api/sku-stock/[sku] — update stock qty or location ───────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sku: string }> },
) {
  const { sku } = await params;
  const skuValue = decodeURIComponent(sku).trim();

  if (!skuValue) {
    return NextResponse.json({ error: 'SKU is required' }, { status: 400 });
  }

  try {
    const body = await request.json();

    // ─── Schema validation (defense-in-depth) ────────────────────────────────
    const parsed = parseBody(SkuStockPatchBody, body);
    if (parsed instanceof NextResponse) return parsed;

    // ─── Idempotency: replay cached response for the same key ────────────────
    const idempotencyKey = readIdempotencyKey(
      request,
      body?.clientEventId ?? body?.idempotencyKey,
    );
    const idempotencyStaffId = Number(body?.staffId);
    if (idempotencyKey) {
      const cached = await getApiIdempotencyResponse(pool, idempotencyKey, ROUTE_SKU_STOCK_PATCH);
      if (cached) {
        return NextResponse.json(cached.response_body, { status: cached.status_code });
      }
    }
    const respond = async (payload: Record<string, unknown>, status = 200) => {
      if (idempotencyKey && status < 500) {
        await saveApiIdempotencyResponse(pool, {
          idempotencyKey,
          route: ROUTE_SKU_STOCK_PATCH,
          staffId:
            Number.isFinite(idempotencyStaffId) && idempotencyStaffId > 0
              ? Math.floor(idempotencyStaffId)
              : null,
          statusCode: status,
          responseBody: payload,
        }).catch((err) => {
          console.warn('sku-stock PATCH: idempotency save failed (non-fatal)', err);
        });
      }
      return NextResponse.json(payload, { status });
    };

    const { action, delta, absoluteQty, location, reason, staffId, productTitle, clearOverride } = body as {
      action: 'adjust' | 'set' | 'location' | 'rename';
      delta?: number;
      absoluteQty?: number;
      location?: string;
      reason?: string;
      staffId?: number;
      /** New custom title to set as display_name_override. */
      productTitle?: string;
      /** When true, sets display_name_override back to NULL. */
      clearOverride?: boolean;
    };

    if (action === 'adjust' && typeof delta === 'number') {
      // Increment/decrement stock
      const result = await pool.query(
        `INSERT INTO sku_stock (sku, stock)
         VALUES ($1, $2)
         ON CONFLICT (sku)
         DO UPDATE SET stock = sku_stock.stock + $2
         RETURNING *`,
        [skuValue, delta],
      );

      // Log to ledger (best-effort)
      await pool
        .query(
          `INSERT INTO sku_stock_ledger (sku, delta, reason, staff_id) VALUES ($1, $2, $3, $4)`,
          [skuValue, delta, reason || 'ADJUSTMENT', staffId || null],
        )
        .catch(() => {});

      return NextResponse.json({ success: true, stock: result.rows[0] });
    }

    if (action === 'set' && typeof absoluteQty === 'number') {
      // Get current stock for ledger delta
      const current = await pool.query(
        `SELECT stock FROM sku_stock WHERE sku = $1`,
        [skuValue],
      );
      const currentQty = Number(current.rows[0]?.stock) || 0;
      const ledgerDelta = absoluteQty - currentQty;

      const result = await pool.query(
        `INSERT INTO sku_stock (sku, stock)
         VALUES ($1, $2)
         ON CONFLICT (sku)
         DO UPDATE SET stock = EXCLUDED.stock
         RETURNING *`,
        [skuValue, absoluteQty],
      );

      // Log to ledger
      if (ledgerDelta !== 0) {
        await pool
          .query(
            `INSERT INTO sku_stock_ledger (sku, delta, reason, staff_id) VALUES ($1, $2, $3, $4)`,
            [skuValue, ledgerDelta, reason || 'SET', staffId || null],
          )
          .catch(() => {});
      }

      return NextResponse.json({ success: true, stock: result.rows[0] });
    }

    if (action === 'location' && typeof location === 'string') {
      // Get current location for transfer log
      const current = await pool.query(
        `SELECT id, location FROM sku_stock WHERE sku = $1`,
        [skuValue],
      );
      const fromLocation = current.rows[0]?.location || null;
      const entityId = current.rows[0]?.id;

      await pool.query(
        `UPDATE sku_stock SET location = $1 WHERE sku = $2`,
        [location.trim(), skuValue],
      );

      // Log the transfer
      if (entityId) {
        await logLocationTransfer({
          entityType: 'SKU_STOCK',
          entityId,
          sku: skuValue,
          fromLocation,
          toLocation: location.trim(),
          staffId: staffId || null,
        }).catch(() => {});
      }

      return NextResponse.json({ success: true, location: location.trim() });
    }

    if (action === 'rename') {
      try {
        await assertPermission(staffId ?? null, 'bin.rename');
      } catch (err) {
        if (err instanceof PermissionDeniedError) {
          return respond(permissionDeniedResponse(err), 403);
        }
        throw err;
      }
      const nextTitle = clearOverride
        ? null
        : typeof productTitle === 'string'
        ? productTitle.trim() || null
        : undefined;
      if (nextTitle === undefined) {
        return respond(
          { error: 'productTitle (or clearOverride:true) is required for rename' },
          400,
        );
      }

      // Capture the prior title so the audit row carries the diff.
      const prior = await pool
        .query<{ display_name_override: string | null; product_title: string | null }>(
          `SELECT display_name_override, product_title FROM sku_stock WHERE sku = $1 LIMIT 1`,
          [skuValue],
        )
        .then((r) => r.rows[0] ?? null);

      await pool.query(
        `INSERT INTO sku_stock (sku, display_name_override, stock)
         VALUES ($1, $2, 0)
         ON CONFLICT (sku)
         DO UPDATE SET display_name_override = EXCLUDED.display_name_override,
                       updated_at = NOW()`,
        [skuValue, nextTitle],
      );

      // Audit — non-quantity event lives in inventory_events alongside the
      // ledger rows so /audit can show the full lifecycle of a SKU.
      try {
        await recordInventoryEvent({
          event_type: 'NOTE',
          actor_staff_id: staffId ?? null,
          station: 'MOBILE',
          sku: skuValue,
          prev_status: prior?.display_name_override ?? null,
          next_status: nextTitle,
          notes: `Renamed display_name_override`,
          payload: {
            action: 'rename',
            prev_title: prior?.display_name_override ?? null,
            next_title: nextTitle,
            catalog_title: prior?.product_title ?? null,
          },
        });
      } catch (err) {
        console.warn('rename: audit insert failed (non-fatal)', err);
      }

      return respond({
        success: true,
        sku: skuValue,
        display_name_override: nextTitle,
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    console.error('[PATCH /api/sku-stock/[sku]] error:', err);
    return NextResponse.json(
      { error: 'Failed to update SKU', details: err?.message },
      { status: 500 },
    );
  }
}
