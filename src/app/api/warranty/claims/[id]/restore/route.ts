import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';
import { restoreClaims } from '@/lib/warranty/mutations';
import { tenantQuery } from '@/lib/tenancy/db';
import { claimIdFromPath, warrantyFlagEnabled, warrantyFlagOff } from '@/lib/warranty/route-helpers';

/**
 * POST /api/warranty/claims/[id]/restore — un-tombstone a soft-deleted claim
 * (reverse of DELETE). Brings it back to the live list with its full trail.
 * 404 when the claim is unknown or already live. Gated by WARRANTY_LOGGER.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!warrantyFlagEnabled()) return warrantyFlagOff();
  const id = claimIdFromPath(request, 2);
  if (id == null) return NextResponse.json({ ok: false, error: 'invalid claim id' }, { status: 400 });

  // Org-ownership pre-check. getClaimTicketRef can't be used here: it filters
  // deleted_at IS NULL, but restore targets soft-deleted claims by definition.
  const { rows: ownRows } = await tenantQuery<{ id: number }>(
    ctx.organizationId,
    `SELECT id FROM warranty_claims WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [id, ctx.organizationId],
  );
  if (!ownRows[0]) {
    return NextResponse.json({ ok: false, error: 'claim not found or not deleted' }, { status: 404 });
  }

  const { restored } = await restoreClaims([id], ctx.staffId ?? null, ctx.organizationId);
  if (restored.length === 0) {
    return NextResponse.json({ ok: false, error: 'claim not found or not deleted' }, { status: 404 });
  }

  await recordAudit(pool, ctx, request, {
    source: 'warranty-logger',
    action: 'warranty.restore',
    entityType: 'warranty_claim',
    entityId: id,
    after: { claimNumber: restored[0].claimNumber },
  });
  return NextResponse.json({ ok: true, restored: restored[0] });
}, { permission: 'warranty.manage', feature: 'repair' });
