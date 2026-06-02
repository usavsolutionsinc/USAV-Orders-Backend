import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { parseBody } from '@/lib/schemas/parse';
import { ReasonCodeUpdateBody } from '@/lib/schemas/reason-codes';
import {
  getReasonCodeById,
  updateReasonCode,
  softDeleteReasonCode,
} from '@/lib/neon/reason-codes-queries';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** GET /api/reason-codes/[id] — fetch a single reason code. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'sku_stock.view');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const reasonCode = await getReasonCodeById(id);
    if (!reasonCode) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, reason_code: reasonCode });
  } catch (err: any) {
    console.error('[GET /api/reason-codes/[id]] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch reason code' },
      { status: 500 },
    );
  }
}

/** PATCH /api/reason-codes/[id] — update fields (code is immutable). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'sku_stock.manage');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(ReasonCodeUpdateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const before = await getReasonCodeById(id);
    if (!before) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const updated = await updateReasonCode(id, parsed);
    if (!updated) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    await recordAudit(pool, gate.ctx, req, {
      source: 'reason-codes-api',
      action: AUDIT_ACTION.REASON_CODE_UPDATE,
      entityType: AUDIT_ENTITY.REASON_CODE,
      entityId: id,
      before: { ...before },
      after: { ...updated },
    });

    return NextResponse.json({ success: true, reason_code: updated });
  } catch (err: any) {
    console.error('[PATCH /api/reason-codes/[id]] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to update reason code' },
      { status: 500 },
    );
  }
}

/** DELETE /api/reason-codes/[id] — soft-delete (is_active = false). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'sku_stock.manage');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const before = await getReasonCodeById(id);
    if (!before || !before.is_active) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const deleted = await softDeleteReasonCode(id);
    if (!deleted) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    await recordAudit(pool, gate.ctx, req, {
      source: 'reason-codes-api',
      action: AUDIT_ACTION.REASON_CODE_DELETE,
      entityType: AUDIT_ENTITY.REASON_CODE,
      entityId: id,
      before: { ...before },
      after: { ...deleted },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[DELETE /api/reason-codes/[id]] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to delete reason code' },
      { status: 500 },
    );
  }
}
