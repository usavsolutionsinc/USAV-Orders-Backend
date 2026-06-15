import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';
import { setQuoteStatus } from '@/lib/warranty/quotes';
import { claimIdFromPath, warrantyFlagEnabled, warrantyFlagOff } from '@/lib/warranty/route-helpers';
import { WarrantyQuoteStatusBody } from '@/lib/schemas/warranty';

/**
 * PATCH /api/warranty/quotes/[id]
 *
 * Move a paid-repair quote DRAFT→SENT→ACCEPTED|DECLINED (or EXPIRED). On ACCEPTED
 * a repair_service ticket is created + linked. Gated by WARRANTY_LOGGER.
 * Permission: warranty.manage.
 */
export const PATCH = withAuth(async (request, ctx) => {
  if (!warrantyFlagEnabled()) return warrantyFlagOff();
  const quoteId = claimIdFromPath(request, 1);
  if (quoteId == null) return NextResponse.json({ ok: false, error: 'invalid quote id' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const parsed = WarrantyQuoteStatusBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    // Tenant isolation: thread the caller's org so setQuoteStatus locates the
    // row with `WHERE id = $1 AND organization_id = $2 FOR UPDATE` (org-ownership
    // 404 gate — a cross-tenant quoteId is treated as not-found, never 403) and
    // org-pins every downstream UPDATE / repair_service handoff to that tenant.
    const result = await setQuoteStatus(quoteId, parsed.data.status, ctx.staffId ?? null, ctx.organizationId);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    await recordAudit(pool, ctx, request, {
      source: 'warranty-logger',
      action: 'warranty.quote_status',
      entityType: 'warranty_quote',
      entityId: quoteId,
      after: { status: parsed.data.status, repairServiceId: result.repairServiceId ?? null },
    });
    return NextResponse.json({ ok: true, quote: result.quote, repairServiceId: result.repairServiceId ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'update quote failed';
    console.error('[PATCH /api/warranty/quotes/[id]] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'warranty.manage' });
