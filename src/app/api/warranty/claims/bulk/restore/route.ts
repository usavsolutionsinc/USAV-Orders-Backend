import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';
import { restoreClaims } from '@/lib/warranty/mutations';
import { tenantQuery } from '@/lib/tenancy/db';
import { idempotentJson, warrantyFlagEnabled, warrantyFlagOff } from '@/lib/warranty/route-helpers';
import { WarrantyClaimBulkDeleteBody } from '@/lib/schemas/warranty';

/**
 * POST /api/warranty/claims/bulk/restore — bulk reverse of the bulk soft-delete.
 *
 * Un-tombstones up to 200 claims by id (one set-based UPDATE). Unknown /
 * already-live ids come back in `results` as ok:false rather than failing the
 * batch. Reuses the bulk-delete `ids` body. Idempotent. Gated by WARRANTY_LOGGER.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!warrantyFlagEnabled()) return warrantyFlagOff();

  const body = await request.json().catch(() => ({}));
  const parsed = WarrantyClaimBulkDeleteBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  return idempotentJson({
    request,
    staffId: ctx.staffId ?? null,
    route: 'POST /api/warranty/claims/bulk/restore',
    bodyKey: parsed.data.idempotencyKey ?? null,
    produce: async () => {
      // Org-ownership pre-check: only restore claims that belong to the caller's
      // org. getClaimTicketRef can't be used (it filters deleted_at IS NULL, but
      // restore targets soft-deleted claims). Cross-tenant ids are bucketed as
      // not-found, identical in shape to the mutation's own notFound result.
      const ownedIds: number[] = [];
      const foreignIds: number[] = [];
      for (const id of parsed.data.ids) {
        const { rows } = await tenantQuery<{ id: number }>(
          ctx.organizationId,
          `SELECT id FROM warranty_claims WHERE id = $1 AND organization_id = $2 LIMIT 1`,
          [id, ctx.organizationId],
        );
        if (rows[0]) ownedIds.push(id);
        else foreignIds.push(id);
      }

      const { restored, notFound } = await restoreClaims(ownedIds, ctx.staffId ?? null);

      const results = [
        ...restored.map((d) => ({ id: d.id, ok: true as const, claimNumber: d.claimNumber })),
        ...notFound.map((id) => ({ id, ok: false as const, error: 'claim not found or not deleted' })),
        ...foreignIds.map((id) => ({ id, ok: false as const, error: 'claim not found or not deleted' })),
      ];

      const notFoundCount = notFound.length + foreignIds.length;
      if (restored.length > 0) {
        await recordAudit(pool, ctx, request, {
          source: 'warranty-logger',
          action: 'warranty.bulk_restore',
          entityType: 'warranty_claim',
          entityId: restored[0].id,
          after: {
            requested: parsed.data.ids.length,
            restored: restored.length,
            notFound: notFoundCount,
            claimNumbers: restored.map((d) => d.claimNumber),
          },
        });
      }

      return {
        status: 200,
        body: { ok: true, restored: restored.length, notFound: notFoundCount, results },
      };
    },
  });
}, { permission: 'warranty.manage' });
