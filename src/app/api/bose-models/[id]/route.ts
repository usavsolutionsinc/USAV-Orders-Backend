import { NextRequest, NextResponse } from 'next/server';
import {
  getBoseModelById,
  getBoseModelDetail,
  softDeleteBoseModel,
  updateBoseModel,
} from '@/lib/neon/bose-model-queries';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { parseBody } from '@/lib/schemas/parse';
import { BoseModelUpdateBody } from '@/lib/schemas/bose-model';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

function parseId(rawId: string): number | null {
  const id = Number(rawId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * GET /api/bose-models/[id] — Model + its compatible parts (joined to stock,
 * lifecycle and open sourcing alerts).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'sourcing.view');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id === null) return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });

    const detail = await getBoseModelDetail(id, gate.ctx.organizationId);
    if (!detail) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    return NextResponse.json({ success: true, ...detail });
  } catch (error: any) {
    console.error('Error in GET /api/bose-models/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch detail' },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/bose-models/[id] — Update a model. `modelNumber` is the natural
 * key and is not editable here.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'sourcing.manage');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id === null) return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });

    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(BoseModelUpdateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const before = await getBoseModelById(id, gate.ctx.organizationId);
    if (!before) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const updated = await updateBoseModel(id, parsed, gate.ctx.organizationId);

    await recordAudit(pool, gate.ctx, req, {
      source: 'bose-models-api',
      action: AUDIT_ACTION.BOSE_MODEL_UPDATE,
      entityType: AUDIT_ENTITY.BOSE_MODEL,
      entityId: id,
      before: { ...before },
      after: { ...updated },
    });

    return NextResponse.json({ success: true, model: updated });
  } catch (error: any) {
    console.error('Error in PATCH /api/bose-models/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/bose-models/[id] — Soft-delete (is_active = false). Compatibility
 * edges reference this id; soft-delete keeps them intact for revival.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'sourcing.manage');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id === null) return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });

    const before = await getBoseModelById(id, gate.ctx.organizationId);
    if (!before || !before.is_active) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const deleted = await softDeleteBoseModel(id, gate.ctx.organizationId);
    if (!deleted) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    await recordAudit(pool, gate.ctx, req, {
      source: 'bose-models-api',
      action: AUDIT_ACTION.BOSE_MODEL_DELETE,
      entityType: AUDIT_ENTITY.BOSE_MODEL,
      entityId: id,
      before: { ...before },
      after: { ...deleted },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in DELETE /api/bose-models/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete' },
      { status: 500 },
    );
  }
}
