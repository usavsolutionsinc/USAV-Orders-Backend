import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import {
  getBinContentsByBarcode,
  getLocationByBarcode,
  adjustBinQty,
  upsertBinContent,
  upsertBinContentIfVersion,
  markBinCounted,
  softDeleteLocation,
} from '@/lib/neon/location-queries';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
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
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import type { AnonymousAuthContext } from '@/lib/auth/withAuth';
import { getCurrentUserBySid } from '@/lib/auth/current-user';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';

const ROUTE_LOCATION_PATCH = 'locations.barcode.patch';

// This route uses Next's typed `{ params }` second arg, which conflicts with
// the `withAuth` wrapper. We resolve the session manually and treat the ctx
// as anonymous-style so the legacy callers (which still send body.staffId)
// keep working until the route is migrated to a withAuth-friendly shape.
async function resolveCtx(req: NextRequest): Promise<AnonymousAuthContext> {
  const sid = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  const user = await getCurrentUserBySid(sid);
  // markAuditWritten is a no-op here — this route doesn't use the withAuth
  // wrapper so there's no audit floor to opt out of. The shape matches
  // AnonymousAuthContext for callsites that pass ctx into recordAudit().
  const noopMark = () => {};
  return user
    ? { user, session: user.session, staffId: user.staffId, organizationId: user.organizationId, role: user.role, permissions: user.permissions, markAuditWritten: noopMark }
    : { user: null, session: null, staffId: null, organizationId: null, role: null, permissions: new Set(), markAuditWritten: noopMark };
}

/**
 * GET /api/locations/[barcode]
 * Scan a bin barcode → returns the bin location + all SKUs stored there.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ barcode: string }> },
) {
  const { barcode } = await params;
  const code = decodeURIComponent(barcode).trim();

  if (!code) {
    return NextResponse.json({ error: 'Barcode is required' }, { status: 400 });
  }

  try {
    // Tenant-scope the lookup: a barcode collides across orgs, so resolve the
    // session org and only return this tenant's bin. Anonymous callers fall
    // back to the legacy un-scoped lookup (orgId undefined).
    const ctx = await resolveCtx(req);
    const orgId = ctx.organizationId ?? undefined;
    const result = await getBinContentsByBarcode(code, orgId);

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

    // Resolve session org up-front so the lookup + every write below is
    // tenant-scoped. Anonymous callers (no session) fall back to legacy
    // un-scoped behavior (orgId undefined).
    const ctx = await resolveCtx(request);
    const orgId = ctx.organizationId ?? undefined;

    const loc = await getLocationByBarcode(code, orgId);
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

    const effectiveStaffId = ctx.staffId ?? (staffId && staffId > 0 ? staffId : null);
    const binCode = loc.barcode ?? code;
    const binLabel = loc.name ?? null;
    const trimmedSku = sku.trim();

    if (action === 'take' && typeof qty === 'number' && qty > 0) {
      const result = await adjustBinQty({
        locationId: loc.id,
        sku: trimmedSku,
        delta: -qty,
        staffId,
        reason: reason || 'TAKEN',
        reasonCodeId: reasonCodeId ?? null,
        notes: notes ?? null,
      }, orgId);
      await recordAudit(pool, ctx, request, {
        source: 'mobile-scanner',
        action: AUDIT_ACTION.SKU_STOCK_ADJUST,
        entityType: AUDIT_ENTITY.BIN,
        entityId: loc.id,
        before: { qty: Number(result.binContent.qty) + qty },
        after: { qty: Number(result.binContent.qty) },
        binCode,
        locationCode: binLabel,
        scanRef: code,
        method: 'scan',
        reasonCode: reason || 'TAKEN',
        note: notes ?? null,
        actorStaffIdOverride: effectiveStaffId,
        extra: { sku: trimmedSku, delta: -qty, total_stock: result.newStockQty, ledger_id: result.ledgerId },
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
        sku: trimmedSku,
        delta: qty,
        staffId,
        reason: reason || 'RECEIVED',
        reasonCodeId: reasonCodeId ?? null,
        notes: notes ?? null,
      }, orgId);
      await recordAudit(pool, ctx, request, {
        source: 'mobile-scanner',
        action: AUDIT_ACTION.SKU_STOCK_ADJUST,
        entityType: AUDIT_ENTITY.BIN,
        entityId: loc.id,
        before: { qty: Number(result.binContent.qty) - qty },
        after: { qty: Number(result.binContent.qty) },
        binCode,
        locationCode: binLabel,
        scanRef: code,
        method: 'scan',
        reasonCode: reason || 'RECEIVED',
        note: notes ?? null,
        actorStaffIdOverride: effectiveStaffId,
        extra: { sku: trimmedSku, delta: qty, total_stock: result.newStockQty, ledger_id: result.ledgerId },
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
        }, orgId);
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
        sku: trimmedSku,
        qty,
        minQty: minQty ?? null,
        maxQty: maxQty ?? null,
      }, orgId);
      await recordAudit(pool, ctx, request, {
        source: 'mobile-scanner',
        action: AUDIT_ACTION.SKU_STOCK_ADJUST,
        entityType: AUDIT_ENTITY.BIN,
        entityId: loc.id,
        after: { qty, min_qty: minQty ?? null, max_qty: maxQty ?? null },
        binCode,
        locationCode: binLabel,
        scanRef: code,
        method: 'scan',
        reasonCode: reason || 'SET',
        note: notes ?? null,
        actorStaffIdOverride: effectiveStaffId,
        extra: { sku: trimmedSku, mode: 'set' },
      });
      return respond({ success: true, binContent: result as unknown as Record<string, unknown> });
    }

    if (action === 'count') {
      await markBinCounted(loc.id, trimmedSku, orgId);
      await recordAudit(pool, ctx, request, {
        source: 'mobile-scanner',
        action: 'bin.count',
        entityType: AUDIT_ENTITY.BIN,
        entityId: loc.id,
        binCode,
        locationCode: binLabel,
        scanRef: code,
        method: 'scan',
        actorStaffIdOverride: effectiveStaffId,
        extra: { sku: trimmedSku },
      });
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

/**
 * DELETE /api/locations/[barcode] — soft-delete a single bin (is_active=false).
 *
 * Uses session-derived auth (requireRoutePerm) rather than this file's legacy
 * body.staffId gate. Refuses to delete a bin that still holds stock (409) so
 * inventory can't silently vanish; empty it or move it first.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ barcode: string }> },
) {
  const gate = await requireRoutePerm(req, 'bin.remove');
  if (gate.denied) return gate.denied;
  const orgId = gate.ctx.organizationId;

  const { barcode } = await params;
  const code = decodeURIComponent(barcode).trim();
  if (!code) {
    return NextResponse.json({ error: 'Barcode is required' }, { status: 400 });
  }

  try {
    // Org-ownership precheck: scope the lookup to this tenant so a barcode
    // belonging to another org resolves to "not found" (404), never deleted.
    const bin = await getBinContentsByBarcode(code, orgId);
    if (!bin || !bin.location.is_active) {
      return NextResponse.json({ error: 'Bin not found' }, { status: 404 });
    }

    const remaining = bin.contents.filter((c) => Number(c.qty) > 0);
    if (remaining.length > 0) {
      return NextResponse.json(
        {
          error: 'Bin is not empty — move or remove its stock before deleting',
          skus: remaining.map((c) => c.sku),
        },
        { status: 409 },
      );
    }

    const deleted = await softDeleteLocation(bin.location.id, orgId);
    if (!deleted) {
      return NextResponse.json({ error: 'Bin not found' }, { status: 404 });
    }

    await recordAudit(pool, gate.ctx, req, {
      source: 'settings.locations',
      action: AUDIT_ACTION.BIN_DELETE,
      entityType: AUDIT_ENTITY.BIN,
      entityId: bin.location.id,
      before: { ...bin.location },
      binCode: bin.location.barcode ?? code,
      locationCode: bin.location.name ?? null,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[DELETE /api/locations/[barcode]] error:', err);
    return NextResponse.json(
      { error: 'Failed to delete bin', details: err?.message },
      { status: 500 },
    );
  }
}
