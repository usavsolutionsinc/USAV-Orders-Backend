import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { isWarrantyLogger } from '@/lib/feature-flags';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';
import { listClaims } from '@/lib/warranty/claims';
import { createClaim } from '@/lib/warranty/mutations';
import { idempotentJson } from '@/lib/warranty/route-helpers';
import { WarrantyClaimCreateBody, WarrantyClaimListQuery } from '@/lib/schemas/warranty';

function flagOff() {
  return NextResponse.json(
    { ok: false, error: 'WARRANTY_LOGGER flag is OFF', flag: 'WARRANTY_LOGGER' },
    { status: 503 },
  );
}

/**
 * GET /api/warranty/claims
 *
 * Lists warranty claims, newest first. Filter via ?status, ?search,
 * ?expiringWithinDays, ?provisionalOnly, ?limit, ?offset.
 * Gated by WARRANTY_LOGGER.
 */
export const GET = withAuth(async (request, ctx) => {
  if (!isWarrantyLogger()) return flagOff();

  const parsed = WarrantyClaimListQuery.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid query', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const claims = await listClaims({
      status: parsed.data.status ?? null,
      search: parsed.data.search ?? null,
      expiringWithinDays: parsed.data.expiringWithinDays ?? null,
      provisionalOnly: parsed.data.provisionalOnly ?? false,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    }, ctx.organizationId);
    return NextResponse.json({ ok: true, claims });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'list warranty claims failed';
    console.error('[GET /api/warranty/claims] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'warranty.view' });

/**
 * POST /api/warranty/claims
 *
 * Logs a new warranty claim. Resolves the order's customer / SKU / carrier
 * delivered date / packed date to stamp the warranty clock, generates a
 * WC-YYYY-NNNNN number, and snapshots the per-org term. Gated by WARRANTY_LOGGER.
 * Idempotent via `Idempotency-Key` header or `idempotencyKey` body field.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!isWarrantyLogger()) return flagOff();
  if (typeof ctx.staffId !== 'number' || ctx.staffId <= 0) {
    return NextResponse.json({ ok: false, error: 'authenticated staff required' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = WarrantyClaimCreateBody.safeParse(body);
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
    route: 'POST /api/warranty/claims',
    bodyKey: parsed.data.idempotencyKey ?? null,
    produce: async () => {
      const result = await createClaim({
        serialNumber: parsed.data.serialNumber ?? null,
        serialUnitId: parsed.data.serialUnitId ?? null,
        orderId: parsed.data.orderId ?? null,
        sku: parsed.data.sku ?? null,
        productTitle: parsed.data.productTitle ?? null,
        customerId: parsed.data.customerId ?? null,
        sourceSystem: parsed.data.sourceSystem ?? null,
        sourceOrderId: parsed.data.sourceOrderId ?? null,
        sourceTrackingNumber: parsed.data.sourceTrackingNumber ?? null,
        purchaseProofUrl: parsed.data.purchaseProofUrl ?? null,
        purchaseProofAttachmentId: parsed.data.purchaseProofAttachmentId ?? null,
        purchasedAt: parsed.data.purchasedAt ?? null,
        deliveredAt: parsed.data.deliveredAt ?? null,
        packedScannedAt: parsed.data.packedScannedAt ?? null,
        notes: parsed.data.notes ?? null,
        createdByStaffId: ctx.staffId,
        organizationId: ctx.organizationId ?? null,
      });
      if (!result.ok) return { status: result.status, body: { ok: false, error: result.error } };
      await recordAudit(pool, ctx, request, {
        source: 'warranty-logger',
        action: 'warranty.create',
        entityType: 'warranty_claim',
        entityId: result.claim.id,
        after: { claimNumber: result.claim.claimNumber, status: result.claim.status },
      });
      return { status: 201, body: { ok: true, claim: result.claim } };
    },
  });
}, { permission: 'warranty.manage' });
