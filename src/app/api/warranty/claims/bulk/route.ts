import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';
import { createClaim, softDeleteClaims } from '@/lib/warranty/mutations';
import { getClaimTicketRef } from '@/lib/warranty/claims';
import { idempotentJson, warrantyFlagEnabled, warrantyFlagOff } from '@/lib/warranty/route-helpers';
import { WarrantyClaimBulkCreateBody, WarrantyClaimBulkDeleteBody } from '@/lib/schemas/warranty';

/**
 * Bulk warranty-claim operations. Both verbs return a per-item `results` array
 * (the request as a whole is 200 even when some items fail) plus created/failed
 * counts, so a partial batch never masquerades as all-or-nothing.
 */

/**
 * POST /api/warranty/claims/bulk
 *
 * Creates up to 100 claims in one call. Items are processed sequentially —
 * claim-number generation is per-year sequential (WC-YYYY-NNNNN), so parallel
 * inserts would just burn its duplicate-key retries. Each item is its own
 * transaction (inside createClaim); one bad item never rolls back its
 * neighbours, it lands in `results` with ok:false instead. Idempotent via
 * `Idempotency-Key` header or `idempotencyKey` body field. Gated by WARRANTY_LOGGER.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!warrantyFlagEnabled()) return warrantyFlagOff();
  if (typeof ctx.staffId !== 'number' || ctx.staffId <= 0) {
    return NextResponse.json({ ok: false, error: 'authenticated staff required' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = WarrantyClaimBulkCreateBody.safeParse(body);
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
    route: 'POST /api/warranty/claims/bulk',
    bodyKey: parsed.data.idempotencyKey ?? null,
    produce: async () => {
      const results: Array<
        | { index: number; ok: true; claim: { id: number; claimNumber: string; status: string } }
        | { index: number; ok: false; error: string }
      > = [];

      for (const [index, item] of parsed.data.items.entries()) {
        try {
          const result = await createClaim({
            serialNumber: item.serialNumber ?? null,
            serialUnitId: item.serialUnitId ?? null,
            orderId: item.orderId ?? null,
            sku: item.sku ?? null,
            productTitle: item.productTitle ?? null,
            customerId: item.customerId ?? null,
            sourceSystem: item.sourceSystem ?? null,
            sourceOrderId: item.sourceOrderId ?? null,
            sourceTrackingNumber: item.sourceTrackingNumber ?? null,
            purchaseProofUrl: item.purchaseProofUrl ?? null,
            purchaseProofAttachmentId: item.purchaseProofAttachmentId ?? null,
            purchasedAt: item.purchasedAt ?? null,
            deliveredAt: item.deliveredAt ?? null,
            packedScannedAt: item.packedScannedAt ?? null,
            notes: item.notes ?? null,
            createdByStaffId: ctx.staffId as number,
            organizationId: ctx.organizationId ?? null,
          });
          if (result.ok) {
            results.push({
              index,
              ok: true,
              claim: {
                id: result.claim.id,
                claimNumber: result.claim.claimNumber,
                status: result.claim.status,
              },
            });
          } else {
            results.push({ index, ok: false, error: result.error });
          }
        } catch (err) {
          results.push({
            index,
            ok: false,
            error: err instanceof Error ? err.message : 'create claim failed',
          });
        }
      }

      const created = results.filter(
        (r): r is { index: number; ok: true; claim: { id: number; claimNumber: string; status: string } } => r.ok,
      );
      if (created.length > 0) {
        await recordAudit(pool, ctx, request, {
          source: 'warranty-logger',
          action: 'warranty.bulk_create',
          entityType: 'warranty_claim',
          entityId: created[0].claim.id,
          after: {
            requested: parsed.data.items.length,
            created: created.length,
            failed: results.length - created.length,
            claimNumbers: created.map((r) => r.claim.claimNumber),
          },
        });
      }

      return {
        status: 200,
        body: {
          ok: true,
          created: created.length,
          failed: results.length - created.length,
          results,
        },
      };
    },
  });
}, { permission: 'warranty.manage' });

/**
 * DELETE /api/warranty/claims/bulk
 *
 * Soft-deletes up to 200 claims by id (deleted_at tombstone — see the single
 * DELETE route). One set-based UPDATE; unknown / already-deleted ids come back
 * in `results` as ok:false rather than failing the batch. Idempotent via
 * `Idempotency-Key` header or `idempotencyKey` body field. Gated by WARRANTY_LOGGER.
 */
export const DELETE = withAuth(async (request, ctx) => {
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
    orgId: ctx.organizationId,
    route: 'DELETE /api/warranty/claims/bulk',
    bodyKey: parsed.data.idempotencyKey ?? null,
    produce: async () => {
      // Org-ownership pre-check: only delete claims that belong to the caller's
      // org. Cross-tenant ids are bucketed as not-found, identical in shape to
      // the mutation's own notFound result.
      const ownedIds: number[] = [];
      const foreignIds: number[] = [];
      for (const id of parsed.data.ids) {
        const owns = await getClaimTicketRef(id, ctx.organizationId);
        if (owns) ownedIds.push(id);
        else foreignIds.push(id);
      }

      const { deleted, notFound } = await softDeleteClaims(ownedIds, ctx.staffId ?? null);

      const results = [
        ...deleted.map((d) => ({ id: d.id, ok: true as const, claimNumber: d.claimNumber })),
        ...notFound.map((id) => ({ id, ok: false as const, error: 'claim not found' })),
        ...foreignIds.map((id) => ({ id, ok: false as const, error: 'claim not found' })),
      ];

      const notFoundCount = notFound.length + foreignIds.length;
      if (deleted.length > 0) {
        await recordAudit(pool, ctx, request, {
          source: 'warranty-logger',
          action: 'warranty.bulk_delete',
          entityType: 'warranty_claim',
          entityId: deleted[0].id,
          after: {
            requested: parsed.data.ids.length,
            deleted: deleted.length,
            notFound: notFoundCount,
            claimNumbers: deleted.map((d) => d.claimNumber),
          },
        });
      }

      return {
        status: 200,
        body: { ok: true, deleted: deleted.length, notFound: notFoundCount, results },
      };
    },
  });
}, { permission: 'warranty.manage' });
