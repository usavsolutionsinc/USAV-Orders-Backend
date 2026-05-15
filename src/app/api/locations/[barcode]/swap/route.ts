import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import {
  adjustBinQty,
  getLocationByBarcode,
  upsertBinContent,
} from '@/lib/neon/location-queries';
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
import { LocationsSwapBody } from '@/lib/schemas/locations';
import { parseBody } from '@/lib/schemas/parse';

const ROUTE_LOCATION_SWAP = 'locations.barcode.swap';

/**
 * POST /api/locations/[barcode]/swap
 * Body: { oldSku, newSku, qty?, staffId? }
 *
 * Replace one SKU with another in the same bin — the user moved physical
 * stock from one labeled product to a freshly-relabeled product, or scanned
 * the wrong SKU and is correcting it.
 *
 * If `qty` is omitted, transfers the entire qty currently sitting on the old
 * SKU's bin row. Each side of the transfer goes through the same writers
 * used by put/take so the sku_stock_ledger keeps an honest trail.
 *
 * No min/max copy-over today — the receiver can set those fresh on the new
 * SKU. We can add a `copyLimits: true` flag later if needed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ barcode: string }> },
) {
  const { barcode } = await params;
  const code = decodeURIComponent(barcode).trim();
  if (!code) {
    return NextResponse.json({ error: 'Barcode is required' }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = parseBody(LocationsSwapBody, body);
    if (parsed instanceof NextResponse) return parsed;
    const oldSku = String(body?.oldSku || '').trim();
    const newSku = String(body?.newSku || '').trim();
    const qtyRequested = Number(body?.qty);
    const staffId =
      Number.isFinite(Number(body?.staffId)) && Number(body?.staffId) > 0
        ? Math.floor(Number(body?.staffId))
        : null;

    // ─── Idempotency: replay cached responses for the same key ──────────────
    const idempotencyKey = readIdempotencyKey(
      request,
      body?.clientEventId ?? body?.idempotencyKey,
    );
    if (idempotencyKey) {
      const cached = await getApiIdempotencyResponse(pool, idempotencyKey, ROUTE_LOCATION_SWAP);
      if (cached) {
        return NextResponse.json(cached.response_body, { status: cached.status_code });
      }
    }
    const respond = async (payload: Record<string, unknown>, status = 200) => {
      if (idempotencyKey && status < 500) {
        await saveApiIdempotencyResponse(pool, {
          idempotencyKey,
          route: ROUTE_LOCATION_SWAP,
          staffId,
          statusCode: status,
          responseBody: payload,
        }).catch((err) => {
          console.warn('locations swap: idempotency save failed (non-fatal)', err);
        });
      }
      return NextResponse.json(payload, { status });
    };

    try {
      await assertPermission(staffId, 'bin.swap');
    } catch (err) {
      if (err instanceof PermissionDeniedError) {
        return respond(permissionDeniedResponse(err), 403);
      }
      throw err;
    }

    if (!oldSku || !newSku) {
      return respond({ error: 'oldSku and newSku are required' }, 400);
    }
    if (oldSku.toUpperCase() === newSku.toUpperCase()) {
      return respond({ error: 'oldSku and newSku must differ' }, 400);
    }

    const loc = await getLocationByBarcode(code);
    if (!loc) {
      return respond({ error: 'Bin not found' }, 404);
    }

    // Current qty on the old SKU's bin row.
    const oldRowRes = await pool.query<{ qty: number; min_qty: number | null; max_qty: number | null }>(
      `SELECT qty, min_qty, max_qty
       FROM bin_contents
       WHERE location_id = $1 AND sku = $2
       LIMIT 1`,
      [loc.id, oldSku],
    );
    const oldQty = Number(oldRowRes.rows[0]?.qty ?? 0);
    if (oldQty <= 0) {
      return respond(
        { error: 'Old SKU has no quantity to swap in this bin' },
        409,
      );
    }

    const transferQty =
      Number.isFinite(qtyRequested) && qtyRequested > 0
        ? Math.min(Math.floor(qtyRequested), oldQty)
        : oldQty;

    // 1. take qty from the old SKU — fires ledger + sku_stock recompute.
    await adjustBinQty({
      locationId: loc.id,
      sku: oldSku,
      delta: -transferQty,
      staffId,
      reason: 'SWAP_OUT',
    });

    // 2. put qty into the new SKU — same path.
    await adjustBinQty({
      locationId: loc.id,
      sku: newSku,
      delta: transferQty,
      staffId,
      reason: 'SWAP_IN',
    });

    // 3. inventory_events row for the lifecycle timeline — non-quantity
    //    event that joins the two ledger rows together by intent.
    try {
      await recordInventoryEvent({
        event_type: 'MOVED',
        actor_staff_id: staffId,
        station: 'MOBILE',
        bin_id: loc.id,
        sku: newSku,
        notes: `SKU swap in bin ${code}: ${oldSku} → ${newSku} (qty ${transferQty})`,
        payload: {
          action: 'sku_swap',
          bin_barcode: code,
          old_sku: oldSku,
          new_sku: newSku,
          qty: transferQty,
        },
      });
    } catch (err) {
      console.warn('swap: audit insert failed (non-fatal)', err);
    }

    return respond({
      success: true,
      bin: { id: loc.id, barcode: loc.barcode, name: loc.name },
      old_sku: oldSku,
      new_sku: newSku,
      qty_transferred: transferQty,
    });
  } catch (err: any) {
    console.error('[POST /api/locations/[barcode]/swap] error:', err);
    return NextResponse.json(
      { error: 'Failed to swap SKU', details: err?.message },
      { status: 500 },
    );
  }
}
