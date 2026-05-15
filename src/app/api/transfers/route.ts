import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import {
  adjustBinQty,
  getLocationByBarcode,
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
import { TransfersBody } from '@/lib/schemas/locations';
import { parseBody } from '@/lib/schemas/parse';

const ROUTE_TRANSFERS = 'transfers.post';

/**
 * POST /api/transfers
 * Body: { fromBinBarcode, toBinBarcode, sku, qty, reasonCodeId?, notes?,
 *         staffId, clientEventId? }
 *
 * Atomic bin-to-bin move: take from A, put to B, write one MOVED row to
 * inventory_events tying both legs together. Each leg goes through the same
 * writer as a normal take/put so the ledger trail stays honest. Idempotent
 * on clientEventId.
 *
 * Required permission: bin.adjust (everyone except readonly). Bin moves are
 * an everyday workflow, not a destructive admin action.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    // ─── Schema validation (defense-in-depth) ───────────────────────────────
    const parsed = parseBody(TransfersBody, body);
    if (parsed instanceof NextResponse) return parsed;

    const fromBarcode = String(body?.fromBinBarcode || '').trim();
    const toBarcode = String(body?.toBinBarcode || '').trim();
    const sku = String(body?.sku || '').trim();
    const qty = Number(body?.qty);
    const reasonCodeId =
      Number.isFinite(Number(body?.reasonCodeId)) && Number(body?.reasonCodeId) > 0
        ? Math.floor(Number(body?.reasonCodeId))
        : null;
    const notes = String(body?.notes || '').trim() || null;
    const staffId =
      Number.isFinite(Number(body?.staffId)) && Number(body?.staffId) > 0
        ? Math.floor(Number(body?.staffId))
        : null;

    // ─── Idempotency: replay cached response for the same key ──────────────
    const idempotencyKey = readIdempotencyKey(
      request,
      body?.clientEventId ?? body?.idempotencyKey,
    );
    if (idempotencyKey) {
      const cached = await getApiIdempotencyResponse(pool, idempotencyKey, ROUTE_TRANSFERS);
      if (cached) {
        return NextResponse.json(cached.response_body, { status: cached.status_code });
      }
    }
    const respond = async (payload: Record<string, unknown>, status = 200) => {
      if (idempotencyKey && status < 500) {
        await saveApiIdempotencyResponse(pool, {
          idempotencyKey,
          route: ROUTE_TRANSFERS,
          staffId,
          statusCode: status,
          responseBody: payload,
        }).catch((err) => {
          console.warn('transfers POST: idempotency save failed (non-fatal)', err);
        });
      }
      return NextResponse.json(payload, { status });
    };

    // ─── Permission gate ────────────────────────────────────────────────────
    try {
      await assertPermission(staffId, 'bin.adjust');
    } catch (err) {
      if (err instanceof PermissionDeniedError) {
        return respond(permissionDeniedResponse(err), 403);
      }
      throw err;
    }

    // ─── Validate ──────────────────────────────────────────────────────────
    if (!fromBarcode || !toBarcode) {
      return respond({ error: 'fromBinBarcode and toBinBarcode are required' }, 400);
    }
    if (fromBarcode.toUpperCase() === toBarcode.toUpperCase()) {
      return respond({ error: 'fromBinBarcode and toBinBarcode must differ' }, 400);
    }
    if (!sku) {
      return respond({ error: 'sku is required' }, 400);
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      return respond({ error: 'qty must be a positive integer' }, 400);
    }
    const transferQty = Math.floor(qty);

    const [fromLoc, toLoc] = await Promise.all([
      getLocationByBarcode(fromBarcode),
      getLocationByBarcode(toBarcode),
    ]);
    if (!fromLoc) return respond({ error: `From bin not found: ${fromBarcode}` }, 404);
    if (!toLoc) return respond({ error: `To bin not found: ${toBarcode}` }, 404);

    // Confirm the source has enough on hand. Negative results would be
    // floored by adjustBinQty but the user expectation is that a short
    // transfer fails up front.
    const sourceQtyRes = await pool.query<{ qty: number }>(
      `SELECT qty FROM bin_contents WHERE location_id = $1 AND sku = $2 LIMIT 1`,
      [fromLoc.id, sku],
    );
    const sourceQty = Number(sourceQtyRes.rows[0]?.qty ?? 0);
    if (sourceQty < transferQty) {
      return respond(
        {
          error: 'INSUFFICIENT_QTY',
          message: `Source bin only has ${sourceQty}; cannot move ${transferQty}.`,
          available: sourceQty,
          requested: transferQty,
        },
        409,
      );
    }

    // 1. Take from source bin.
    await adjustBinQty({
      locationId: fromLoc.id,
      sku,
      delta: -transferQty,
      staffId,
      reason: 'TRANSFER_OUT',
      reasonCodeId,
      notes,
    });

    // 2. Put into destination bin.
    await adjustBinQty({
      locationId: toLoc.id,
      sku,
      delta: transferQty,
      staffId,
      reason: 'TRANSFER_IN',
      reasonCodeId,
      notes,
    });

    // 3. Single lifecycle event linking the two legs.
    try {
      await recordInventoryEvent({
        event_type: 'MOVED',
        actor_staff_id: staffId,
        station: 'MOBILE',
        bin_id: toLoc.id,
        prev_bin_id: fromLoc.id,
        sku,
        notes,
        payload: {
          action: 'bin_transfer',
          from_bin: fromLoc.barcode ?? fromBarcode,
          to_bin: toLoc.barcode ?? toBarcode,
          qty: transferQty,
        },
      });
    } catch (err) {
      console.warn('transfers: inventory_events insert failed (non-fatal)', err);
    }

    return respond({
      success: true,
      from_bin: { id: fromLoc.id, name: fromLoc.name, barcode: fromLoc.barcode },
      to_bin: { id: toLoc.id, name: toLoc.name, barcode: toLoc.barcode },
      sku,
      qty: transferQty,
    });
  } catch (err: any) {
    console.error('[POST /api/transfers] error:', err);
    return NextResponse.json(
      { error: 'Failed to transfer', details: err?.message },
      { status: 500 },
    );
  }
}
