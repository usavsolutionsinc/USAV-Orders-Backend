import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import {
  getBinContentsByBarcode,
  getLocationByBarcode,
  adjustBinQty,
  upsertBinContent,
  upsertBinContentIfVersion,
  markBinCounted,
} from '@/lib/neon/location-queries';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import {
  assertPermission,
  type PermissionAction,
  PermissionDeniedError,
  permissionDeniedResponse,
} from '@/lib/auth/permissions';
import { LocationsPatchBody } from '@/lib/schemas/locations';
import { parseBody } from '@/lib/schemas/parse';

const ROUTE_LOCATION_PATCH = 'locations.barcode.patch';

/**
 * GET /api/locations/[barcode]
 * Scan a bin barcode → returns the bin location + all SKUs stored there.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ barcode: string }> },
) {
  const { barcode } = await params;
  const code = decodeURIComponent(barcode).trim();

  if (!code) {
    return NextResponse.json({ error: 'Barcode is required' }, { status: 400 });
  }

  try {
    const result = await getBinContentsByBarcode(code);

    if (!result) {
      return NextResponse.json(
        { error: 'Bin not found', barcode: code },
        { status: 404 },
      );
    }

    return NextResponse.json({
      location: {
        id: result.location.id,
        name: result.location.name,
        room: result.location.room,
        rowLabel: result.location.row_label,
        colLabel: result.location.col_label,
        barcode: result.location.barcode,
        binType: result.location.bin_type,
        capacity: result.location.capacity,
      },
      contents: result.contents.map((c: any) => ({
        id: c.id,
        sku: c.sku,
        qty: c.qty,
        minQty: c.min_qty,
        maxQty: c.max_qty,
        lastCounted: c.last_counted,
        productTitle: c.product_title,
        displayNameOverride: c.display_name_override ?? null,
        // Version token for optimistic concurrency on `set` action.
        updatedAt: c.updated_at,
      })),
    });
  } catch (err: any) {
    console.error('[GET /api/locations/[barcode]] error:', err);
    return NextResponse.json(
      { error: 'Failed to load bin', details: err?.message },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/locations/[barcode]
 * Actions: take, put, set, count
 *
 * take:  { action: "take",  sku, qty, staffId?, reason? }  — subtract from bin + sku_stock
 * put:   { action: "put",   sku, qty, staffId?, reason? }  — add to bin + sku_stock
 * set:   { action: "set",   sku, qty, minQty?, maxQty? }   — set absolute bin qty
 * count: { action: "count", sku }                           — mark bin as physically counted
 */
export async function PATCH(
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

    // ─── Schema validation (defense-in-depth) ───────────────────────────────
    const parsed = parseBody(LocationsPatchBody, body);
    if (parsed instanceof NextResponse) return parsed;

    // ─── Idempotency: replay cached responses for the same key ──────────────
    const idempotencyKey = readIdempotencyKey(request, body?.clientEventId ?? body?.idempotencyKey);
    const idempotencyStaffId = Number(body?.staffId);
    if (idempotencyKey) {
      const cached = await getApiIdempotencyResponse(pool, idempotencyKey, ROUTE_LOCATION_PATCH);
      if (cached) {
        return NextResponse.json(cached.response_body, { status: cached.status_code });
      }
    }

    const loc = await getLocationByBarcode(code);
    if (!loc) {
      return NextResponse.json({ error: 'Bin not found' }, { status: 404 });
    }
    const {
      action,
      sku,
      qty,
      staffId,
      reason,
      reasonCodeId,
      notes,
      minQty,
      maxQty,
      expectedUpdatedAt,
    } = body as {
      action: 'take' | 'put' | 'set' | 'count';
      sku?: string;
      /** ISO timestamp from a prior GET — when set, `action=set` rejects stale writes. */
      expectedUpdatedAt?: string;
      qty?: number;
      staffId?: number;
      /** Legacy free-text reason (still stored for back-compat). */
      reason?: string;
      /** Preferred — FK into reason_codes for categorized reporting. */
      reasonCodeId?: number;
      /** Required by some reasons (DAMAGED, FOUND, …). */
      notes?: string;
      minQty?: number;
      maxQty?: number;
    };

    // Capture every response through this helper so idempotency-key replays
    // get the same body byte-for-byte. 5xx errors intentionally do NOT cache —
    // we want retries to actually retry.
    const respond = async (payload: Record<string, unknown>, status = 200) => {
      if (idempotencyKey && status < 500) {
        await saveApiIdempotencyResponse(pool, {
          idempotencyKey,
          route: ROUTE_LOCATION_PATCH,
          staffId:
            Number.isFinite(idempotencyStaffId) && idempotencyStaffId > 0
              ? Math.floor(idempotencyStaffId)
              : null,
          statusCode: status,
          responseBody: payload,
        }).catch((err) => {
          console.warn('locations PATCH: idempotency save failed (non-fatal)', err);
        });
      }
      return NextResponse.json(payload, { status });
    };

    if (!sku?.trim()) {
      return respond({ error: 'SKU is required' }, 400);
    }

    // ─── Permission gate ───────────────────────────────────────────────────
    // Map each action to the matching permission. Everyone except 'readonly'
    // gets bin.adjust / bin.set / bin.add_sku.
    const requiredPerm: PermissionAction | null =
      action === 'take' || action === 'put'
        ? 'bin.adjust'
        : action === 'set' || action === 'count'
        ? 'bin.set'
        : null;
    if (requiredPerm) {
      try {
        await assertPermission(staffId ?? null, requiredPerm);
      } catch (err) {
        if (err instanceof PermissionDeniedError) {
          return respond(permissionDeniedResponse(err), 403);
        }
        throw err;
      }
    }

    if (action === 'take' && typeof qty === 'number' && qty > 0) {
      const result = await adjustBinQty({
        locationId: loc.id,
        sku: sku.trim(),
        delta: -qty,
        staffId,
        reason: reason || 'TAKEN',
        reasonCodeId: reasonCodeId ?? null,
        notes: notes ?? null,
      });
      return respond({
        success: true,
        binQty: result.binContent.qty,
        totalStock: result.newStockQty,
        ledgerId: result.ledgerId,
        binId: loc.id,
      });
    }

    if (action === 'put' && typeof qty === 'number' && qty > 0) {
      const result = await adjustBinQty({
        locationId: loc.id,
        sku: sku.trim(),
        delta: qty,
        staffId,
        reason: reason || 'RECEIVED',
        reasonCodeId: reasonCodeId ?? null,
        notes: notes ?? null,
      });
      return respond({
        success: true,
        binQty: result.binContent.qty,
        totalStock: result.newStockQty,
        ledgerId: result.ledgerId,
        binId: loc.id,
      });
    }

    if (action === 'set' && typeof qty === 'number') {
      // Optimistic concurrency: when the caller supplies an expectedUpdatedAt
      // timestamp from their prior GET, we only apply the write if the row
      // hasn't moved since. Two devices racing to change min/max on the same
      // row no longer silently overwrite each other.
      if (typeof expectedUpdatedAt === 'string' && expectedUpdatedAt.trim()) {
        const versioned = await upsertBinContentIfVersion({
          locationId: loc.id,
          sku: sku.trim(),
          qty,
          minQty: minQty ?? null,
          maxQty: maxQty ?? null,
          expectedUpdatedAt: expectedUpdatedAt.trim(),
        });
        if (!versioned.ok) {
          return respond(
            {
              error: 'STALE',
              message:
                'Another device updated this row since you loaded it. Refresh and try again.',
              current: versioned.current as unknown as Record<string, unknown> | null,
            },
            409,
          );
        }
        return respond({
          success: true,
          binContent: versioned.row as unknown as Record<string, unknown>,
        });
      }
      const result = await upsertBinContent({
        locationId: loc.id,
        sku: sku.trim(),
        qty,
        minQty: minQty ?? null,
        maxQty: maxQty ?? null,
      });
      return respond({ success: true, binContent: result as unknown as Record<string, unknown> });
    }

    if (action === 'count') {
      await markBinCounted(loc.id, sku.trim());
      return respond({ success: true });
    }

    return respond({ error: 'Invalid action' }, 400);
  } catch (err: any) {
    console.error('[PATCH /api/locations/[barcode]] error:', err);
    return NextResponse.json(
      { error: 'Failed to update bin', details: err?.message },
      { status: 500 },
    );
  }
}
