/**
 * /api/pending-skus — the "create in Zoho" to-do queue (sku-reconciliation plan).
 * ────────────────────────────────────────────────────────────────────────────
 * Thin listing + steward-action surface over `src/lib/inventory/pending-skus.ts`.
 * When an operational SKU can't resolve to sku_catalog (the product hasn't been
 * created in Zoho yet — Zoho is the SoT), it lands in `pending_skus`. This route
 * lets a steward read that to-do list (GET) and dismiss junk entries (PATCH →
 * status IGNORED). Creation of new entries is the write path elsewhere
 * (resolveSkuCatalogIdOrQueue / POST /api/sku-catalog/flag-missing); resolution
 * to CREATED is automatic via the sku_catalog trigger + reconcilePendingForCatalog.
 *
 * NOTE (tenancy): `pending_skus` is currently a GLOBAL table — it has NO
 * organization_id column and `normalized_sku` is globally UNIQUE (see migration
 * 2026-06-06b_pending_skus.sql). The lib helpers (`listPendingSkus`,
 * `ignorePendingSku`) query the shared pool directly and do NOT take an org. We
 * therefore deliberately do NOT pretend to org-scope this queue here (no
 * withTenantTransaction GUC, no WHERE org_id) — that would be a no-op against a
 * column that doesn't exist. Org isolation of this queue is a separate,
 * already-tracked tenancy concern. The audit row IS org-scoped via withAuth ctx.
 *
 * Business logic stays in the lib; this file only validates, delegates, maps the
 * HTTP status, and audits.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { PendingSkuIgnoreBody, PendingSkuListQuery } from '@/lib/schemas/sku-catalog';
import { ignorePendingSku, listPendingSkus } from '@/lib/inventory/pending-skus';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

/**
 * GET /api/pending-skus — the "needs creating in Zoho" to-do list.
 *
 * Query: ?status=PENDING|CREATED|IGNORED|DUPLICATE (default PENDING) · ?limit=N
 *        (1..1000, default 200). Ordered by how often each SKU blocks work.
 * Resp:  { success, pending: PendingSkuRow[] }
 */
export const GET = withAuth(
  async (req: NextRequest) => {
    try {
      const { searchParams } = new URL(req.url);
      const parsed = parseBody(PendingSkuListQuery, {
        status: searchParams.get('status') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
      });
      if (parsed instanceof NextResponse) return parsed;

      const pending = await listPendingSkus({
        status: parsed.status,
        limit: parsed.limit,
      });

      return NextResponse.json({ success: true, pending });
    } catch (error: any) {
      console.error('Error in GET /api/pending-skus:', error);
      return NextResponse.json(
        { success: false, error: error?.message || 'Failed to list pending SKUs' },
        { status: 500 },
      );
    }
  },
  { permission: 'sku_stock.view' },
);

/**
 * PATCH /api/pending-skus — steward dismisses a junk SKU from the to-do list
 * (status PENDING → IGNORED). Only PENDING rows are actionable, so a missing or
 * already-resolved row returns 404.
 *
 * Body: { id, notes? }
 * Resp: { success, pending: PendingSkuRow }
 */
export const PATCH = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const raw = await req.json().catch(() => ({}));
      const parsed = parseBody(PendingSkuIgnoreBody, raw);
      if (parsed instanceof NextResponse) return parsed;

      const pending = await ignorePendingSku(parsed.id, parsed.notes ?? null);
      // The lib only flips PENDING → IGNORED, so a null return means the row is
      // absent OR already past PENDING (CREATED/IGNORED/DUPLICATE) — both 404.
      if (!pending) {
        return NextResponse.json(
          { success: false, error: 'Pending SKU not found or not in PENDING status' },
          { status: 404 },
        );
      }

      // Reuse the existing pending_skus queue audit verb (no dedicated "ignore"
      // action exists; per repo convention we reuse the closest rather than
      // inventing one). The IGNORED status in `after` makes the intent explicit.
      await recordAudit(pool, ctx, req, {
        source: 'pending-skus-api',
        action: AUDIT_ACTION.SKU_CATALOG_FLAG_MISSING,
        entityType: AUDIT_ENTITY.SKU,
        entityId: pending.id,
        before: null,
        after: {
          normalized_sku: pending.normalized_sku,
          raw_sku: pending.raw_sku,
          status: pending.status,
          notes: pending.notes,
        },
      });

      return NextResponse.json({ success: true, pending });
    } catch (error: any) {
      console.error('Error in PATCH /api/pending-skus:', error);
      return NextResponse.json(
        { success: false, error: error?.message || 'Failed to ignore pending SKU' },
        { status: 500 },
      );
    }
  },
  { permission: 'sku_stock.manage' },
);
