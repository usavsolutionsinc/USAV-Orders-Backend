/**
 * POST /api/sku-catalog/flag-missing
 *
 * One-step "this item isn't in the system yet" flag for the OCR local-pickup
 * intake (P2-AI-01). When the operator photographs a product label, the vision
 * box OCRs it, and the model resolves to NO catalog row (`resolved: false`), the
 * operator can either create a SKU outright (existing POST /api/sku-catalog) or —
 * when they don't have a SKU yet — flag the item as missing-in-system here.
 *
 * This is a thin, additive wrapper over the existing `queuePendingSku()` helper
 * (the "needs creating in Zoho" to-do queue). It never mints/mutates a catalog
 * row and never touches a unit serial — flagging is metadata only. Idempotent by
 * construction: `queuePendingSku` upserts on the normalized SKU and only bumps
 * `occurrences` on a repeat sighting, so a double-tap can't duplicate.
 *
 * NOTE (tenancy): `pending_skus` is currently a GLOBAL table — it has no
 * organization_id column and `normalized_sku` is globally UNIQUE (see migration
 * 2026-06-06b_pending_skus.sql). Org isolation of this queue is a separate,
 * already-tracked tenancy concern; this route stays write-only (enqueue) and does
 * not expose cross-tenant reads. The audit row IS org-scoped via withAuth ctx.
 *
 * Body: { sku, suggestedTitle?, source? }
 * Resp: { success, pending: PendingSkuRow }
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { SkuCatalogFlagMissingBody } from '@/lib/schemas/sku-catalog';
import { queuePendingSku } from '@/lib/inventory/pending-skus';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const raw = await req.json().catch(() => ({}));
      const parsed = parseBody(SkuCatalogFlagMissingBody, raw);
      if (parsed instanceof NextResponse) return parsed;

      const pending = await queuePendingSku({
        rawSku: parsed.sku,
        source: parsed.source ?? 'scan',
        suggestedTitle: parsed.suggestedTitle ?? null,
      });

      if (!pending) {
        return NextResponse.json(
          { success: false, error: 'sku is required' },
          { status: 400 },
        );
      }

      await recordAudit(pool, ctx, req, {
        source: 'sku-catalog-flag-missing',
        action: AUDIT_ACTION.SKU_CATALOG_FLAG_MISSING,
        entityType: AUDIT_ENTITY.SKU,
        entityId: pending.id,
        before: null,
        after: {
          normalized_sku: pending.normalized_sku,
          raw_sku: pending.raw_sku,
          status: pending.status,
          occurrences: pending.occurrences,
          suggested_title: pending.suggested_title,
        },
      });

      return NextResponse.json({ success: true, pending }, { status: 201 });
    } catch (error: any) {
      console.error('Error in POST /api/sku-catalog/flag-missing:', error);
      return NextResponse.json(
        { success: false, error: error?.message || 'Failed to flag item as missing' },
        { status: 500 },
      );
    }
  },
  { permission: 'sku_stock.manage' },
);
