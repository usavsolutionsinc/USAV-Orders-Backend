import { NextRequest, NextResponse } from 'next/server';
import {
  getSkuCatalogById,
  getSkuCatalogDetail,
  softDeleteSkuCatalog,
  upsertSkuCatalog,
} from '@/lib/neon/sku-catalog-queries';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { parseBody } from '@/lib/schemas/parse';
import { SkuCatalogUpdateBody } from '@/lib/schemas/sku-catalog';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { tenantQuery } from '@/lib/tenancy/db';
import pool from '@/lib/db';
import { upsertSkuPackProfileLink } from '@/lib/neon/pack-profile-links';

/**
 * GET /api/sku-catalog/[id] — Full detail for a single SKU catalog entry.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'sku_stock.view');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const detail = await getSkuCatalogDetail(id, gate.ctx.organizationId);
    if (!detail) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, ...detail });
  } catch (error: any) {
    console.error('Error in GET /api/sku-catalog/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch detail' },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/sku-catalog/[id] — Update a SKU catalog entry.
 *
 * Body: { productTitle?, category?, upc?, ean?, imageUrl?, isActive? }
 * `sku` is the natural key and is not editable here.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'sku_stock.manage');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(SkuCatalogUpdateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const before = await getSkuCatalogById(id, gate.ctx.organizationId);
    if (!before) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const updated = await upsertSkuCatalog({
      sku: before.sku,
      productTitle: parsed.productTitle ?? before.product_title,
      category: parsed.category !== undefined ? parsed.category : before.category,
      upc: parsed.upc !== undefined ? parsed.upc : before.upc,
      ean: parsed.ean !== undefined ? parsed.ean : before.ean,
      imageUrl: parsed.imageUrl !== undefined ? parsed.imageUrl : before.image_url,
      isActive: parsed.isActive !== undefined ? parsed.isActive : before.is_active,
      lifecycleStatus: parsed.lifecycleStatus !== undefined ? parsed.lifecycleStatus : before.lifecycle_status,
      reorderThreshold: parsed.reorderThreshold !== undefined ? parsed.reorderThreshold : before.reorder_threshold,
      lastKnownCostCents: parsed.lastKnownCostCents !== undefined ? parsed.lastKnownCostCents : before.last_known_cost_cents,
      sourcingNotes: parsed.sourcingNotes !== undefined ? parsed.sourcingNotes : before.sourcing_notes,
      replenishTargetCents: parsed.replenishTargetCents !== undefined ? parsed.replenishTargetCents : before.replenish_target_cents,
      notes: parsed.packNotes !== undefined ? parsed.packNotes : before.notes,
    }, gate.ctx.organizationId);

    // Optional polymorphic packing KPI override linked to this SKU.
    // If both fields are explicitly null/empty, the helper deletes the link.
    if (parsed.packTier !== undefined || parsed.estimatedPackMinutes !== undefined) {
      await upsertSkuPackProfileLink(
        {
          skuCatalogId: id,
          packTier: parsed.packTier ?? null,
          estimatedMinutes: parsed.estimatedPackMinutes ?? null,
          source: 'manual',
        },
        gate.ctx.organizationId,
      );
    }

    await recordAudit(pool, gate.ctx, req, {
      source: 'sku-catalog-api',
      action: AUDIT_ACTION.SKU_CATALOG_UPDATE,
      entityType: AUDIT_ENTITY.SKU,
      entityId: id,
      before: { ...before },
      after: { ...updated },
    });

    return NextResponse.json({ success: true, catalog: updated });
  } catch (error: any) {
    console.error('Error in PATCH /api/sku-catalog/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/sku-catalog/[id] — Soft-delete (is_active = false).
 *
 * We never hard-delete: platform ids, manuals, QC checks, stock ledger and
 * audit rows all reference this id. The row simply drops out of active lists
 * and can be revived by re-creating the same sku.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'sku_stock.manage');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const before = await getSkuCatalogById(id, gate.ctx.organizationId);
    if (!before || !before.is_active) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    // Guard: don't hide a SKU that's physically in bins — it would vanish from
    // active pick/replenish lists while stock still sits on the shelf. Empty or
    // move it first. (bin_contents.sku is the natural text key, not an FK.)
    const orgId = gate.ctx.organizationId;
    const stockSql = `SELECT COALESCE(SUM(qty), 0)::int AS qty FROM bin_contents WHERE sku = $1${orgId ? ' AND organization_id = $2' : ''}`;
    const stock = orgId
      ? await tenantQuery<{ qty: number }>(orgId, stockSql, [before.sku, orgId])
      : await pool.query<{ qty: number }>(stockSql, [before.sku]);
    const onHand = stock.rows[0]?.qty ?? 0;
    if (onHand > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `SKU still has ${onHand} unit${onHand === 1 ? '' : 's'} in bins — move or remove the stock before deactivating.`,
        },
        { status: 409 },
      );
    }

    const deleted = await softDeleteSkuCatalog(id, gate.ctx.organizationId);
    if (!deleted) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    await recordAudit(pool, gate.ctx, req, {
      source: 'sku-catalog-api',
      action: AUDIT_ACTION.SKU_CATALOG_DELETE,
      entityType: AUDIT_ENTITY.SKU,
      entityId: id,
      before: { ...before },
      after: { ...deleted },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in DELETE /api/sku-catalog/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete' },
      { status: 500 },
    );
  }
}
