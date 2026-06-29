import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { unpairReceivingCarton } from '@/lib/receiving/unpair-po';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

/**
 * POST /api/receiving/:id/unpair
 *
 * The "Unlink / Undo pairing" action in Package Pairing — the explicit revert of
 * a wrong link. Fully drops the carton back to Unfound: strips the per-line
 * source-order linkage + PO and clears the carton header (source → 'unmatched',
 * platform → null). Sanctioned audited DOWNGRADE (mirror of the relink upgrade
 * override). House skeleton: guard → domain helper → map status → cache + realtime
 * → recordAudit.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(request, 'receiving.scan_po');
    if (gate.denied) return gate.denied;
    const ctx = gate.ctx;

    const { id: idRaw } = await params;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Valid id is required' }, { status: 400 });
    }

    const result = await unpairReceivingCarton(id, ctx.organizationId);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }

    await invalidateCacheTags(['receiving-lines', 'receiving-logs', 'pending-unboxing']);
    await publishReceivingLogChanged({
      organizationId: ctx.organizationId,
      action: 'update',
      rowId: String(id),
      source: 'receiving.unpair',
    });

    await recordAudit(pool, ctx, request, {
      source: 'receiving.unpair',
      action: AUDIT_ACTION.RECEIVING_RELINK,
      entityType: AUDIT_ENTITY.RECEIVING,
      entityId: id,
      before: result.before,
      after: {
        zoho_purchaseorder_id: null,
        zoho_purchaseorder_number: null,
        source: 'unmatched',
        source_platform: null,
        lines_cleared: result.linesCleared,
      },
      method: 'manual',
    });

    return NextResponse.json({
      success: true,
      receiving_id: id,
      lines_cleared: result.linesCleared,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to unpair carton';
    console.error('receiving/[id]/unpair POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
