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
import { withTenantTransaction } from '@/lib/tenancy/db';

export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const raw = await req.json().catch(() => ({}));
      const parsed = parseBody(SkuCatalogFlagMissingBody, raw);
      if (parsed instanceof NextResponse) return parsed;

      // Tenant GUC: run both the pending-sku enqueue and the audit write on the
      // tenant client so they execute under `app.current_org` (RLS-subject under
      // the app_tenant role). `pending_skus` is global today, but routing it
      // through the tenant connection keeps every DB touch on one GUC-scoped path
      // and auto-stamps the org-scoped audit row.
      const pending = await withTenantTransaction(ctx.organizationId, async (client) => {
        const row = await queuePendingSku(
          {
            rawSku: parsed.sku,
            source: parsed.source ?? 'scan',
            suggestedTitle: parsed.suggestedTitle ?? null,
          },
          client,
        );
        if (!row) return null;

        await recordAudit(client, ctx, req, {
          source: 'sku-catalog-flag-missing',
          action: AUDIT_ACTION.SKU_CATALOG_FLAG_MISSING,
          entityType: AUDIT_ENTITY.SKU,
          entityId: row.id,
          before: null,
          after: {
            normalized_sku: row.normalized_sku,
            raw_sku: row.raw_sku,
            status: row.status,
            occurrences: row.occurrences,
            suggested_title: row.suggested_title,
          },
        });
        return row;
      });

      if (!pending) {
        return NextResponse.json(
          { success: false, error: 'sku is required' },
          { status: 400 },
        );
      }

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
