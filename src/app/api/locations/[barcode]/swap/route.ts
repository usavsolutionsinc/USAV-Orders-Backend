import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import {
  adjustBinQty,
  getLocationByBarcode,
  upsertBinContent,
} from '@/lib/neon/location-queries';
import { recordInventoryEvent } from '@/lib/inventory/events';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
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
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import type { AnonymousAuthContext } from '@/lib/auth/withAuth';
import { getCurrentUserBySid } from '@/lib/auth/current-user';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { USAV_ORG_ID, type OrgId } from '@/lib/tenancy/constants';

const ROUTE_LOCATION_SWAP = 'locations.barcode.swap';

async function resolveCtx(req: NextRequest): Promise<AnonymousAuthContext> {
  const sid = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  const user = await getCurrentUserBySid(sid);
  const noopMark = () => {};
  return user
    ? { user, session: user.session, staffId: user.staffId, organizationId: user.organizationId, role: user.role, permissions: user.permissions, markAuditWritten: noopMark }
    : { user: null, session: null, staffId: null, organizationId: null, role: null, permissions: new Set(), markAuditWritten: noopMark };
}

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

    // Resolve session org up-front so the bin lookup + both adjustBinQty
    // writes + the bin_contents read + the inventory_events write are all
    // tenant-scoped. Anonymous callers fall back to legacy un-scoped behavior.
    const ctx = await resolveCtx(request);
    const orgId = ctx.organizationId ?? undefined;
    // The idempotency cache requires a concrete tenant; anonymous (legacy QR)
    // callers fall back to USAV so the org-scoped cache row still resolves.
    const idempotencyOrgId: OrgId = ctx.organizationId ?? USAV_ORG_ID;

    // ─── Idempotency: replay cached responses for the same key ──────────────
    const idempotencyKey = readIdempotencyKey(
      request,
      body?.clientEventId ?? body?.idempotencyKey,
    );
    if (idempotencyKey) {
      const cached = await getApiIdempotencyResponse(pool, idempotencyOrgId, idempotencyKey, ROUTE_LOCATION_SWAP);
      if (cached) {
        return NextResponse.json(cached.response_body, { status: cached.status_code });
      }
    }
    const respond = async (payload: Record<string, unknown>, status = 200) => {
      if (idempotencyKey && status < 500) {
        await saveApiIdempotencyResponse(pool, {
          orgId: idempotencyOrgId,
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

    const loc = await getLocationByBarcode(code, orgId);
    if (!loc) {
      return respond({ error: 'Bin not found' }, 404);
    }

    // Current qty on the old SKU's bin row. `sku` collides across orgs, so the
    // probe is org-scoped when a session org is present.
    const oldRowRes = orgId
      ? await tenantQuery<{ qty: number; min_qty: number | null; max_qty: number | null }>(
          orgId,
          `SELECT qty, min_qty, max_qty
       FROM bin_contents
       WHERE location_id = $1 AND sku = $2 AND organization_id = $3
       LIMIT 1`,
          [loc.id, oldSku, orgId],
        )
      : await pool.query<{ qty: number; min_qty: number | null; max_qty: number | null }>(
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
    }, orgId);

    // 2. put qty into the new SKU — same path.
    await adjustBinQty({
      locationId: loc.id,
      sku: newSku,
      delta: transferQty,
      staffId,
      reason: 'SWAP_IN',
    }, orgId);

    // 3. inventory_events row for the lifecycle timeline — non-quantity
    //    event that joins the two ledger rows together by intent.
    //    recordInventoryEvent relies on the `app.current_org` GUC default to
    //    stamp the tenant. Run it inside withTenantTransaction (with the
    //    idempotencyOrgId fallback, so an anonymous-context swap still attributes
    //    to USAV instead of inserting a NULL organization_id and being dropped).
    try {
      await withTenantTransaction(idempotencyOrgId, (client) =>
        recordInventoryEvent({
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
        }, client, idempotencyOrgId),
      );
    } catch (err) {
      console.warn('swap: audit insert failed (non-fatal)', err);
    }

    await recordAudit(pool, ctx, request, {
      source: 'mobile-scanner',
      action: AUDIT_ACTION.BIN_SWAP,
      entityType: AUDIT_ENTITY.BIN,
      entityId: loc.id,
      before: { sku: oldSku, qty: oldQty },
      after: { sku: newSku, qty: transferQty },
      binCode: loc.barcode ?? code,
      locationCode: loc.name ?? null,
      scanRef: code,
      method: 'scan',
      actorStaffIdOverride: staffId,
      extra: { old_sku: oldSku, new_sku: newSku, qty_transferred: transferQty },
    });

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
