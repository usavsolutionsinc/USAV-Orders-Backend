import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { parseBody } from '@/lib/schemas/parse';
import { TypeUpdateBody } from '@/lib/schemas/catalog';
import { getTypeById, updateType } from '@/lib/neon/catalog-queries';
import { invalidateCatalogCache } from '@/lib/catalog/org-catalog';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** PATCH /api/catalog/types/[id] — rename / reorder / (de)activate. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'admin.manage_features');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id == null) return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });

    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(TypeUpdateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const before = await getTypeById(gate.ctx.organizationId, id);
    if (!before) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const updated = await updateType(gate.ctx.organizationId, id, {
      label: parsed.label,
      kind: parsed.kind,
      isReturn: parsed.isReturn,
      sortOrder: parsed.sortOrder,
      isActive: parsed.isActive,
    });

    await recordAudit(pool, gate.ctx, req, {
      source: 'catalog-api',
      action: 'catalog.type.update',
      entityType: 'catalog_type',
      entityId: id,
      before: { ...before },
      after: updated ? { ...updated } : null,
    });

    invalidateCatalogCache(gate.ctx.organizationId);
    return NextResponse.json({ success: true, type: updated });
  } catch (error: any) {
    console.error('Error in PATCH /api/catalog/types/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update type' },
      { status: 500 },
    );
  }
}

/** DELETE /api/catalog/types/[id] — soft delete (is_active = false). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'admin.manage_features');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id == null) return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });

    const before = await getTypeById(gate.ctx.organizationId, id);
    if (!before || !before.is_active) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const updated = await updateType(gate.ctx.organizationId, id, { isActive: false });

    await recordAudit(pool, gate.ctx, req, {
      source: 'catalog-api',
      action: 'catalog.type.delete',
      entityType: 'catalog_type',
      entityId: id,
      before: { ...before },
      after: updated ? { ...updated } : null,
    });

    invalidateCatalogCache(gate.ctx.organizationId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in DELETE /api/catalog/types/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete type' },
      { status: 500 },
    );
  }
}
