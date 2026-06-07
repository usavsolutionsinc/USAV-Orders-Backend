import { NextRequest, NextResponse } from 'next/server';
import { getSourcingCandidateById, updateCandidate } from '@/lib/neon/sourcing-queries';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { parseBody } from '@/lib/schemas/parse';
import { SourcingCandidateUpdateBody } from '@/lib/schemas/sourcing';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

/**
 * PATCH /api/sourcing/candidates/[id] — Status transition / re-link a candidate.
 * Body: { status?, skuId?, boseModelId?, supplierId?, sourcingAlertId?, notes? }
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'sourcing.manage');
    if (gate.denied) return gate.denied;
    const id = Number((await params).id);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(SourcingCandidateUpdateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const before = await getSourcingCandidateById(id);
    if (!before) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const updated = await updateCandidate(id, {
      status: parsed.status,
      skuId: parsed.skuId,
      boseModelId: parsed.boseModelId,
      supplierId: parsed.supplierId,
      sourcingAlertId: parsed.sourcingAlertId,
    });

    await recordAudit(pool, gate.ctx, req, {
      source: 'sourcing-candidates-api',
      action: AUDIT_ACTION.SOURCING_CANDIDATE_UPDATE,
      entityType: AUDIT_ENTITY.SOURCING_CANDIDATE,
      entityId: id,
      before: { ...before },
      after: updated ? { ...updated } : null,
    });

    return NextResponse.json({ success: true, candidate: updated });
  } catch (error: any) {
    if (error?.code === '23503') {
      return NextResponse.json(
        { success: false, error: 'Unknown skuId, boseModelId, supplierId or sourcingAlertId' },
        { status: 400 },
      );
    }
    console.error('Error in PATCH /api/sourcing/candidates/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update candidate' },
      { status: 500 },
    );
  }
}
