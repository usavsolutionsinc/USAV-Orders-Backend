import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';
import type { OrgId } from '@/lib/tenancy/constants';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { getShipStationV2, ShipStationNotConnectedError } from '@/lib/shipping/shipstation/config';
import { ShipStationApiError } from '@/lib/shipping/shipstation/client';
import { VoidLabelBodySchema } from '@/lib/shipping/shipstation/rate-request';

export const dynamic = 'force-dynamic';

/**
 * POST /api/shipping/labels/void — void/refund a purchased label by engine
 * label id (operator/station entry; the generic sibling of
 * /api/outbound/labels/void, which additionally unwinds an order's linkage).
 *
 * The carrier is the source of truth on whether the void is approved
 * (usage/time-window dependent) — a decline maps to 409. LABEL_VOIDED is an
 * AUDIT_REASON_REQUIRED action, so `reason` is mandatory.
 *
 * Missing per-org ShipStation credentials → 409 { error: 'NOT_CONNECTED' }.
 *
 * Body: { labelId, reason }
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const orgId = ctx.organizationId as OrgId;
    const raw = await req.json().catch(() => null);
    const parsed = VoidLabelBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Invalid body', issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { labelId, reason } = parsed.data;

    const v2 = await getShipStationV2(orgId);
    const result = await v2.voidLabel(labelId);
    if (!result.approved) {
      return NextResponse.json(
        { ok: false, approved: false, error: result.message || 'The carrier declined the void request.' },
        { status: 409 },
      );
    }

    await recordAudit(pool, ctx, req, {
      source: 'api.shipping.labels.void',
      action: AUDIT_ACTION.LABEL_VOIDED,
      entityType: AUDIT_ENTITY.SHIPMENT,
      entityId: labelId,
      reasonCode: reason,
      before: { labelId },
    });

    return NextResponse.json({ ok: true, approved: true, message: result.message ?? null });
  } catch (error) {
    if (error instanceof ShipStationNotConnectedError) {
      return NextResponse.json(
        { ok: false, error: 'NOT_CONNECTED', message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof ShipStationApiError) {
      if (error.isNotConnected) {
        return NextResponse.json(
          { ok: false, error: 'NOT_CONNECTED', message: error.message },
          { status: 409 },
        );
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
    }
    return errorResponse(error, 'POST /api/shipping/labels/void');
  }
}, { permission: 'shipping.void_label' });
