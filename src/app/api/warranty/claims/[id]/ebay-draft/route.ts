import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';
import { getClaim } from '@/lib/warranty/claims';
import { buildEbayRefurbDraft } from '@/lib/warranty/ebay-draft';
import { claimIdFromPath, warrantyFlagEnabled, warrantyFlagOff } from '@/lib/warranty/route-helpers';

/**
 * POST /api/warranty/claims/[id]/ebay-draft
 *
 * Assemble a DRAFT eBay "refurbished unit" listing payload from a repaired
 * claim, for a human to review/publish. Never auto-publishes. Gated by
 * WARRANTY_LOGGER. Permission: warranty.manage.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!warrantyFlagEnabled()) return warrantyFlagOff();
  const id = claimIdFromPath(request, 2);
  if (id == null) return NextResponse.json({ ok: false, error: 'invalid claim id' }, { status: 400 });

  try {
    const claim = await getClaim(id, ctx.organizationId);
    if (!claim) return NextResponse.json({ ok: false, error: 'claim not found' }, { status: 404 });

    const draft = buildEbayRefurbDraft(claim);
    await recordAudit(pool, ctx, request, {
      source: 'warranty-logger',
      action: 'warranty.ebay_draft',
      entityType: 'warranty_claim',
      entityId: id,
      after: { title: draft.title, conditionId: draft.conditionId },
    });
    return NextResponse.json({ ok: true, draft });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ebay draft failed';
    console.error('[POST /api/warranty/claims/[id]/ebay-draft] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'warranty.manage', feature: 'repair' });
