import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getLocationByBarcode, updateLocation } from '@/lib/neon/location-queries';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { parseBody } from '@/lib/schemas/parse';
import { LocationPropertiesPatchBody } from '@/lib/schemas/locations';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

/**
 * PATCH /api/locations/[barcode]/properties
 *
 * Edit a bin's own metadata — name, barcode, bin type, capacity, sort order.
 * This is deliberately separate from PATCH /api/locations/[barcode], which is
 * reserved for stock content actions (take / put / set / count). Structural
 * edits reuse `sku_stock.manage`, the same gate as room renames.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ barcode: string }> },
) {
  const gate = await requireRoutePerm(req, 'sku_stock.manage');
  if (gate.denied) return gate.denied;
  const orgId = gate.ctx.organizationId;

  const { barcode } = await params;
  const code = decodeURIComponent(barcode).trim();
  if (!code) {
    return NextResponse.json({ error: 'Barcode is required' }, { status: 400 });
  }

  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(LocationPropertiesPatchBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    // Org-ownership precheck: a barcode collides across orgs, so scope the
    // lookup to this tenant — another org's bin reads as "not found" (404).
    const before = await getLocationByBarcode(code, orgId);
    if (!before || !before.is_active) {
      return NextResponse.json({ error: 'Bin not found' }, { status: 404 });
    }

    const updated = await updateLocation(before.id, {
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.barcode !== undefined ? { barcode: parsed.barcode } : {}),
      ...(parsed.binType !== undefined ? { binType: parsed.binType } : {}),
      ...(parsed.capacity !== undefined ? { capacity: parsed.capacity } : {}),
      ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {}),
    }, orgId);
    if (!updated) {
      return NextResponse.json({ error: 'Bin not found' }, { status: 404 });
    }

    await recordAudit(pool, gate.ctx, req, {
      source: 'settings.locations',
      action: AUDIT_ACTION.BIN_UPDATE,
      entityType: AUDIT_ENTITY.BIN,
      entityId: before.id,
      before: { ...before },
      after: { ...updated },
      binCode: updated.barcode ?? code,
      locationCode: updated.name ?? null,
    });

    return NextResponse.json({ success: true, location: updated });
  } catch (err: any) {
    if (err?.code === '23505' || /unique/i.test(err?.message || '')) {
      return NextResponse.json(
        { error: 'Another bin already uses that name or barcode' },
        { status: 409 },
      );
    }
    console.error('[PATCH /api/locations/[barcode]/properties] error:', err);
    return NextResponse.json(
      { error: 'Failed to update bin', details: err?.message },
      { status: 500 },
    );
  }
}
