import { NextRequest, NextResponse } from 'next/server';
import {
  getBoseModelByModelNumber,
  getBoseModelList,
  upsertBoseModel,
} from '@/lib/neon/bose-model-queries';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { BoseModelCreateBody } from '@/lib/schemas/bose-model';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

const ROUTE_BOSE_MODELS_POST = 'bose-models.post';

/**
 * GET /api/bose-models — Paginated Bose model catalog with compatibility counts.
 * Query: q, family, limit (1–500), offset.
 */
export const GET = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q') || '';
    const family = searchParams.get('family');
    const limit = Math.max(1, Math.min(500, Number(searchParams.get('limit') || 100)));
    const offset = Math.max(0, Number(searchParams.get('offset') || 0));

    const { items, total } = await getBoseModelList({ q, family, limit, offset });
    return NextResponse.json({ success: true, items, total });
  } catch (error: any) {
    console.error('Error in GET /api/bose-models:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch Bose models' },
      { status: 500 },
    );
  }
}, { permission: 'sourcing.view' });

/**
 * POST /api/bose-models — Create a Bose model catalog entry.
 *
 * `modelNumber` is the natural unique key. A retried create with the same
 * `Idempotency-Key` replays the original 201; a genuinely new create for an
 * already-active model number is a 409.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(BoseModelCreateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
    if (idemKey) {
      const hit = await getApiIdempotencyResponse(pool, idemKey, ROUTE_BOSE_MODELS_POST);
      if (hit) return NextResponse.json(hit.response_body, { status: hit.status_code });
    }

    const existing = await getBoseModelByModelNumber(parsed.modelNumber);
    if (existing && existing.is_active) {
      return NextResponse.json(
        { success: false, error: 'A Bose model with that model number already exists', id: existing.id },
        { status: 409 },
      );
    }

    const model = await upsertBoseModel({
      modelNumber: parsed.modelNumber,
      modelName: parsed.modelName,
      family: parsed.family ?? null,
      productType: parsed.productType ?? null,
      releaseYear: parsed.releaseYear ?? null,
      eolDate: parsed.eolDate ?? null,
      imageUrl: parsed.imageUrl ?? null,
      notes: parsed.notes ?? null,
      isActive: parsed.isActive ?? true,
    });

    await recordAudit(pool, ctx, req, {
      source: 'bose-models-api',
      action: AUDIT_ACTION.BOSE_MODEL_CREATE,
      entityType: AUDIT_ENTITY.BOSE_MODEL,
      entityId: model.id,
      before: existing ? { ...existing } : null,
      after: { ...model },
    });

    const responseBody = { success: true, model };
    if (idemKey) {
      await saveApiIdempotencyResponse(pool, {
        idempotencyKey: idemKey,
        route: ROUTE_BOSE_MODELS_POST,
        staffId: ctx.staffId,
        statusCode: 201,
        responseBody,
      });
    }

    return NextResponse.json(responseBody, { status: 201 });
  } catch (error: any) {
    if (error?.code === '23505' || /unique/i.test(error?.message || '')) {
      return NextResponse.json(
        { success: false, error: 'A Bose model with that model number already exists' },
        { status: 409 },
      );
    }
    console.error('Error in POST /api/bose-models:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create Bose model' },
      { status: 500 },
    );
  }
}, { permission: 'sourcing.manage' });
