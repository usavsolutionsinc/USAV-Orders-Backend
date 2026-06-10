import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { isWarrantyLogger } from '@/lib/feature-flags';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';
import { getClaim } from '@/lib/warranty/claims';
import { softDeleteClaims, updateClaimMeta } from '@/lib/warranty/mutations';
import { claimIdFromPath, idempotentJson, warrantyFlagOff } from '@/lib/warranty/route-helpers';
import { WarrantyClaimUpdateBody } from '@/lib/schemas/warranty';

/**
 * GET /api/warranty/claims/[id]
 *
 * Fetch a single warranty claim with its event timeline + repair attempts.
 * Gated by WARRANTY_LOGGER.
 */
export const GET = withAuth(async (request) => {
  if (!isWarrantyLogger()) {
    return NextResponse.json(
      { ok: false, error: 'WARRANTY_LOGGER flag is OFF', flag: 'WARRANTY_LOGGER' },
      { status: 503 },
    );
  }

  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const id = Number(segments[segments.length - 1]);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid claim id' }, { status: 400 });
  }

  try {
    const claim = await getClaim(id);
    if (!claim) return NextResponse.json({ ok: false, error: 'claim not found' }, { status: 404 });
    return NextResponse.json({ ok: true, claim });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'get warranty claim failed';
    console.error('[GET /api/warranty/claims/[id]] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'warranty.view' });

/**
 * PATCH /api/warranty/claims/[id]
 *
 * Edits claim metadata (serial, SKU, customer, purchase proof, notes…). Status
 * moves through the dedicated verb routes, not here. Gated by WARRANTY_LOGGER.
 */
export const PATCH = withAuth(async (request, ctx) => {
  if (!isWarrantyLogger()) return warrantyFlagOff();
  const id = claimIdFromPath(request, 1);
  if (id == null) return NextResponse.json({ ok: false, error: 'invalid claim id' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const parsed = WarrantyClaimUpdateBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { idempotencyKey, ...fields } = parsed.data;
  return idempotentJson({
    request,
    staffId: ctx.staffId ?? null,
    route: 'PATCH /api/warranty/claims/[id]',
    bodyKey: idempotencyKey ?? null,
    produce: async () => {
      const result = await updateClaimMeta(id, fields, ctx.staffId ?? null);
      if (!result.ok) return { status: result.status, body: { ok: false, error: result.error } };
      await recordAudit(pool, ctx, request, {
        source: 'warranty-logger',
        action: 'warranty.update',
        entityType: 'warranty_claim',
        entityId: id,
        after: { fields: Object.keys(fields) },
      });
      return { status: 200, body: { ok: true, claim: result.claim } };
    },
  });
}, { permission: 'warranty.manage' });

/**
 * DELETE /api/warranty/claims/[id]
 *
 * Soft-deletes a claim (deleted_at tombstone — claims keep their event/audit
 * trail and RMA / repair links, so rows are never hard-dropped). Idempotent at
 * the domain level: deleting an already-deleted claim returns 404. Gated by
 * WARRANTY_LOGGER.
 */
export const DELETE = withAuth(async (request, ctx) => {
  if (!isWarrantyLogger()) return warrantyFlagOff();
  const id = claimIdFromPath(request, 1);
  if (id == null) return NextResponse.json({ ok: false, error: 'invalid claim id' }, { status: 400 });

  try {
    const result = await softDeleteClaims([id], ctx.staffId ?? null);
    if (result.deleted.length === 0) {
      return NextResponse.json({ ok: false, error: 'claim not found' }, { status: 404 });
    }
    await recordAudit(pool, ctx, request, {
      source: 'warranty-logger',
      action: 'warranty.delete',
      entityType: 'warranty_claim',
      entityId: id,
      before: { claimNumber: result.deleted[0].claimNumber },
      after: { deleted: true },
    });
    return NextResponse.json({ ok: true, deleted: result.deleted[0] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'delete warranty claim failed';
    console.error('[DELETE /api/warranty/claims/[id]] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'warranty.manage' });
