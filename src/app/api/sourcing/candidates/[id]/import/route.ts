import { NextRequest, NextResponse } from 'next/server';
import {
  getAcquisitionByCandidateId,
  getSourcingCandidateById,
  importCandidate,
} from '@/lib/neon/sourcing-queries';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { parseBody } from '@/lib/schemas/parse';
import { SourcingImportBody } from '@/lib/schemas/sourcing';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

const ROUTE_CANDIDATE_IMPORT = 'sourcing-candidate.import';

/**
 * POST /api/sourcing/candidates/[id]/import — Import a candidate into inventory.
 *
 * Idempotent on three levels so a retry never doubles a receiving row:
 *   1. `Idempotency-Key` replays the prior response.
 *   2. An existing acquisition for the candidate replays its receiving id.
 *   3. The import itself runs in one transaction.
 *
 * Effect: upsert supplier → create receiving (source_platform='ebay') →
 * part_acquisitions(status='ordered') → stamp last_known_cost_cents. Returns
 * the receiving id to route into the normal unbox flow.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'sourcing.import');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;
    const id = Number((await params).id);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(SourcingImportBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    // 1. Idempotency-Key replay.
    const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
    if (idemKey) {
      const hit = await getApiIdempotencyResponse(pool, orgId, idemKey, ROUTE_CANDIDATE_IMPORT);
      if (hit) return NextResponse.json(hit.response_body, { status: hit.status_code });
    }

    const candidate = await getSourcingCandidateById(id, orgId);
    if (!candidate) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    // 2. Already imported — replay the existing receiving id (no second row).
    const existing = await getAcquisitionByCandidateId(id, orgId);
    if (existing) {
      return NextResponse.json(
        {
          success: true,
          alreadyImported: true,
          receivingId: existing.receiving_id,
          acquisition: existing,
        },
        { status: 200 },
      );
    }

    // 3. Run the import transaction.
    const result = await importCandidate({
      candidate,
      skuId: parsed.skuId,
      acquisitionCostCents: parsed.acquisitionCostCents ?? null,
      shippingCostCents: parsed.shippingCostCents ?? null,
      condition: parsed.condition ?? null,
      carrier: parsed.carrier ?? null,
      supplierId: parsed.supplierId ?? null,
      staffId: gate.ctx.staffId,
    }, orgId);

    await recordAudit(pool, gate.ctx, req, {
      source: 'sourcing-import-api',
      action: AUDIT_ACTION.SOURCING_CANDIDATE_IMPORT,
      entityType: AUDIT_ENTITY.PART_ACQUISITION,
      entityId: result.acquisition.id,
      reasonCode: parsed.reason ?? null,
      before: { ...candidate },
      after: {
        receiving_id: result.receivingId,
        acquisition_id: result.acquisition.id,
        supplier_id: result.supplier?.id ?? null,
      },
    });

    const responseBody = {
      success: true,
      receivingId: result.receivingId,
      acquisition: result.acquisition,
      supplier: result.supplier,
      candidate: result.candidate,
    };
    if (idemKey) {
      await saveApiIdempotencyResponse(pool, {
        orgId,
        idempotencyKey: idemKey,
        route: ROUTE_CANDIDATE_IMPORT,
        staffId: gate.ctx.staffId,
        statusCode: 201,
        responseBody,
      });
    }

    return NextResponse.json(responseBody, { status: 201 });
  } catch (error: any) {
    if (error?.code === '23503') {
      return NextResponse.json(
        { success: false, error: 'Unknown skuId or supplierId' },
        { status: 400 },
      );
    }
    console.error('Error in POST /api/sourcing/candidates/[id]/import:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to import candidate' },
      { status: 500 },
    );
  }
}
