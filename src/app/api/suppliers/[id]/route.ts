import { NextRequest, NextResponse } from 'next/server';
import {
  getSupplierById,
  softDeleteSupplier,
  updateSupplier,
} from '@/lib/neon/suppliers-queries';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { parseBody } from '@/lib/schemas/parse';
import { SupplierUpdateBody } from '@/lib/schemas/supplier';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

function parseId(rawId: string): number | null {
  const id = Number(rawId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * GET /api/suppliers/[id] — Single supplier.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'supplier.view');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;
    const id = parseId((await params).id);
    if (!id) return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });

    const supplier = await getSupplierById(id, orgId);
    if (!supplier) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    return NextResponse.json({ success: true, supplier });
  } catch (error: any) {
    console.error('Error in GET /api/suppliers/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch supplier' },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/suppliers/[id] — Update a supplier.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'supplier.manage');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;
    const id = parseId((await params).id);
    if (!id) return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });

    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(SupplierUpdateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const before = await getSupplierById(id, orgId);
    if (!before) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const updated = await updateSupplier(id, {
      name: parsed.name,
      supplierType: parsed.supplierType,
      email: parsed.email,
      phone: parsed.phone,
      url: parsed.url,
      ebaySellerId: parsed.ebaySellerId,
      rating: parsed.rating,
      leadTimeDays: parsed.leadTimeDays,
      notes: parsed.notes,
      isActive: parsed.isActive,
    }, orgId);

    await recordAudit(pool, gate.ctx, req, {
      source: 'suppliers-api',
      action: AUDIT_ACTION.SUPPLIER_UPDATE,
      entityType: AUDIT_ENTITY.SUPPLIER,
      entityId: id,
      before: { ...before },
      after: updated ? { ...updated } : null,
    });

    return NextResponse.json({ success: true, supplier: updated });
  } catch (error: any) {
    if (error?.code === '23505' || /unique/i.test(error?.message || '')) {
      return NextResponse.json(
        { success: false, error: 'A supplier with that eBay seller id already exists' },
        { status: 409 },
      );
    }
    console.error('Error in PATCH /api/suppliers/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update supplier' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/suppliers/[id] — Soft-delete (is_active = false). Candidates and
 * acquisitions reference this id (ON DELETE SET NULL), so we preserve the row.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'supplier.manage');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;
    const id = parseId((await params).id);
    if (!id) return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });

    const before = await getSupplierById(id, orgId);
    if (!before || !before.is_active) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const deleted = await softDeleteSupplier(id, orgId);
    if (!deleted) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    await recordAudit(pool, gate.ctx, req, {
      source: 'suppliers-api',
      action: AUDIT_ACTION.SUPPLIER_DELETE,
      entityType: AUDIT_ENTITY.SUPPLIER,
      entityId: id,
      before: { ...before },
      after: { ...deleted },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in DELETE /api/suppliers/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete supplier' },
      { status: 500 },
    );
  }
}
