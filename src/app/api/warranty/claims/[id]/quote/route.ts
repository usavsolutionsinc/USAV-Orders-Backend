import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';
import { createQuote } from '@/lib/warranty/quotes';
import { getClaimTicketRef } from '@/lib/warranty/claims';
import { claimIdFromPath, idempotentJson, warrantyFlagEnabled, warrantyFlagOff } from '@/lib/warranty/route-helpers';
import { WarrantyQuoteCreateBody } from '@/lib/schemas/warranty';

/**
 * POST /api/warranty/claims/[id]/quote
 *
 * Create a post-warranty paid-repair quote (DRAFT). Gated by WARRANTY_LOGGER.
 * Permission: warranty.manage.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!warrantyFlagEnabled()) return warrantyFlagOff();
  if (typeof ctx.staffId !== 'number' || ctx.staffId <= 0) {
    return NextResponse.json({ ok: false, error: 'authenticated staff required' }, { status: 401 });
  }
  const id = claimIdFromPath(request, 2);
  if (id == null) return NextResponse.json({ ok: false, error: 'invalid claim id' }, { status: 400 });

  const owns = await getClaimTicketRef(id, ctx.organizationId);
  if (!owns) return NextResponse.json({ ok: false, error: 'claim not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const parsed = WarrantyQuoteCreateBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  return idempotentJson({
    request,
    staffId: ctx.staffId,
    orgId: ctx.organizationId,
    route: 'POST /api/warranty/claims/[id]/quote',
    bodyKey: parsed.data.idempotencyKey ?? null,
    produce: async () => {
      const result = await createQuote(id, {
        lineItems: parsed.data.lineItems,
        tax: parsed.data.tax ?? 0,
        validUntil: parsed.data.validUntil ?? null,
        createdByStaffId: ctx.staffId,
      }, ctx.organizationId);
      if (!result.ok) return { status: result.status, body: { ok: false, error: result.error } };
      await recordAudit(pool, ctx, request, {
        source: 'warranty-logger',
        action: 'warranty.quote_create',
        entityType: 'warranty_claim',
        entityId: id,
        after: { quoteNumber: result.quote.quoteNumber, total: result.quote.total },
      });
      return { status: 201, body: { ok: true, quote: result.quote } };
    },
  });
}, { permission: 'warranty.manage', feature: 'repair' });
