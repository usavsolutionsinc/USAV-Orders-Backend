import { NextRequest, NextResponse } from 'next/server';
import {
  deleteCompatibility,
  getCompatibilityById,
  updateCompatibility,
} from '@/lib/neon/part-compatibility-queries';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { parseBody } from '@/lib/schemas/parse';
import { PartCompatibilityUpdateBody } from '@/lib/schemas/part-compatibility';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

function parseId(rawId: string): number | null {
  const id = Number(rawId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * PATCH /api/part-compatibility/[id] — Update an edge's attributes.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'sourcing.manage');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id === null) return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });

    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(PartCompatibilityUpdateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const before = await getCompatibilityById(id);
    if (!before) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const updated = await updateCompatibility(id, parsed);

    await recordAudit(pool, gate.ctx, req, {
      source: 'part-compatibility-api',
      action: AUDIT_ACTION.PART_COMPATIBILITY_UPDATE,
      entityType: AUDIT_ENTITY.PART_COMPATIBILITY,
      entityId: id,
      before: { ...before },
      after: { ...updated },
    });

    return NextResponse.json({ success: true, compatibility: updated });
  } catch (error: any) {
    console.error('Error in PATCH /api/part-compatibility/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/part-compatibility/[id] — Hard-delete the edge (pure relationship
 * data; the before-state is captured in the audit log).
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'sourcing.manage');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id === null) return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });

    const before = await getCompatibilityById(id);
    if (!before) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const ok = await deleteCompatibility(id);
    if (!ok) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    await recordAudit(pool, gate.ctx, req, {
      source: 'part-compatibility-api',
      action: AUDIT_ACTION.PART_COMPATIBILITY_DELETE,
      entityType: AUDIT_ENTITY.PART_COMPATIBILITY,
      entityId: id,
      before: { ...before },
      after: null,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in DELETE /api/part-compatibility/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete' },
      { status: 500 },
    );
  }
}
