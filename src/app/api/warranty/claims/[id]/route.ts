import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { isWarrantyLogger } from '@/lib/feature-flags';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';
import { getClaim } from '@/lib/warranty/claims';
import { updateClaimMeta } from '@/lib/warranty/mutations';
import { claimIdFromPath, warrantyFlagOff } from '@/lib/warranty/route-helpers';
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

  try {
    const result = await updateClaimMeta(id, parsed.data, ctx.staffId ?? null);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    await recordAudit(pool, ctx, request, {
      source: 'warranty-logger',
      action: 'warranty.update',
      entityType: 'warranty_claim',
      entityId: id,
      after: { fields: Object.keys(parsed.data) },
    });
    return NextResponse.json({ ok: true, claim: result.claim });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'update warranty claim failed';
    console.error('[PATCH /api/warranty/claims/[id]] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'warranty.manage' });
