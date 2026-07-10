import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { parseBody } from '@/lib/schemas/parse';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { recordPackingTick } from '@/lib/packing/packing-checks';

/**
 * POST /api/orders/[id]/packing-checks — persist one packing-checklist tick
 * (packing-checklist-plan Phase 2).
 *
 * Path `[id]` = orders.id (the line PK). Body carries which checklist item was
 * confirmed/cleared. Results land in tech_verifications
 * (source_kind='order', step_type='PACKING'|'PACKING_PART') via the idempotent
 * `(source_kind, source_row_id, step_type, step_id)` upsert — a retry with the
 * same `clientEventId` (or without) re-marks the same single row, never
 * duplicates. Mirrors the serial-units/[id]/checklist house pattern.
 *
 * Persistence is advisory: the pack flow itself is never gated here (blocking
 * lives in kit-readiness enforcement, client-side).
 */

const PackingCheckBody = z.object({
  kind: z.enum(['KIT_PART', 'PACKING_CHECK']),
  stepId: z.number().int().positive(),
  checked: z.boolean(),
  /** Client-minted idempotency/trace id — recorded in the audit trail. */
  clientEventId: z.string().trim().min(8).max(64).optional(),
});

export const POST = withAuth(async (request, ctx) => {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  // .../api/orders/[id]/packing-checks → id is segments[-2]
  const orderRowId = Number(segments[segments.length - 2]);
  if (!Number.isFinite(orderRowId) || orderRowId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid order id' }, { status: 400 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = parseBody(PackingCheckBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  const verifiedBy = Number(ctx.staffId);
  if (!Number.isFinite(verifiedBy) || verifiedBy <= 0) {
    return NextResponse.json({ ok: false, error: 'no staff identity on request' }, { status: 401 });
  }

  try {
    const result = await recordPackingTick(ctx.organizationId, {
      orderRowId,
      kind: parsed.kind,
      stepId: parsed.stepId,
      checked: parsed.checked,
      verifiedBy,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    await recordAudit(pool, ctx, request, {
      source: 'order-packing-checks',
      action: AUDIT_ACTION.QC_RESULT_RECORD,
      entityType: AUDIT_ENTITY.ORDER,
      entityId: orderRowId,
      method: 'manual',
      extra: {
        kind: parsed.kind,
        step_type: result.stepType,
        step_id: parsed.stepId,
        checked: parsed.checked,
        client_event_id: parsed.clientEventId ?? null,
      },
    });

    return NextResponse.json({ ok: true, verification: result.verification });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to record packing check';
    console.error('[POST /api/orders/[id]/packing-checks] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'packing.complete_order' });
