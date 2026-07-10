import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';
import type { OrgId } from '@/lib/tenancy/constants';
import { tenantQuery } from '@/lib/tenancy/db';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { getShipStationV2, ShipStationNotConnectedError } from '@/lib/shipping/shipstation/config';
import { ShipStationApiError } from '@/lib/shipping/shipstation/client';
import { PurchaseLabelBodySchema } from '@/lib/shipping/shipstation/rate-request';

export const dynamic = 'force-dynamic';

const AUDIT_SOURCE = 'api.shipping.labels';

/**
 * POST /api/shipping/labels — buy a quoted rate (operator/station entry).
 *
 * The generic sibling of /api/outbound/labels/purchase: no order anchor — it
 * buys the exact rate quoted by POST /api/shipping/rates and returns the label.
 * Callers that have an order should prefer the outbound route (it registers
 * tracking, stores the label document, and emails the customer).
 *
 * Idempotency: `clientEventId` is required; a prior successful purchase under
 * the same key (found via this route's LABEL_PURCHASED audit row) short-circuits
 * instead of buying a second label. ShipStation's create-label is NOT itself
 * idempotent and audit writes are best-effort, so the UI must also disable
 * double-submit — same residual window the outbound route documents.
 *
 * Missing per-org ShipStation credentials → 409 { error: 'NOT_CONNECTED' }.
 *
 * Body: { rateId, clientEventId, labelFormat?, labelLayout? }
 * Returns { ok, labelId, trackingNumber, labelDownload, … }.
 */

type PriorPurchase = { after_data: Record<string, unknown> | null };

async function findPriorPurchase(
  orgId: OrgId,
  clientEventId: string,
): Promise<Record<string, unknown> | null> {
  const res = await tenantQuery<PriorPurchase>(
    orgId,
    `SELECT after_data
       FROM audit_logs
      WHERE organization_id = $1
        AND source = $2
        AND action = $3
        AND metadata->>'clientEventId' = $4
      ORDER BY id DESC
      LIMIT 1`,
    [orgId, AUDIT_SOURCE, AUDIT_ACTION.LABEL_PURCHASED, clientEventId],
  );
  return res.rows[0]?.after_data ?? null;
}

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const orgId = ctx.organizationId as OrgId;
    const raw = await req.json().catch(() => null);
    const parsed = PurchaseLabelBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Invalid body', issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { rateId, clientEventId, labelFormat, labelLayout } = parsed.data;

    // Idempotency short-circuit — a retry must not buy a second label.
    const prior = await findPriorPurchase(orgId, clientEventId);
    if (prior) {
      return NextResponse.json({ ok: true, idempotent: true, ...prior });
    }

    // Buy the label — IRREVERSIBLE (charges the connected carrier account).
    const v2 = await getShipStationV2(orgId);
    const label = await v2.purchaseLabelFromRate(rateId, { labelFormat, labelLayout });

    const after = {
      labelId: label.labelId,
      trackingNumber: label.trackingNumber,
      carrierCode: label.carrierCode,
      serviceCode: label.serviceCode,
      cost: label.cost,
      currency: label.currency,
      shipDate: label.shipDate,
      labelDownload: label.labelDownload,
      rateId,
    };

    // recordAudit never throws; the row doubles as the idempotency marker.
    await recordAudit(pool, ctx, req, {
      source: AUDIT_SOURCE,
      action: AUDIT_ACTION.LABEL_PURCHASED,
      entityType: AUDIT_ENTITY.SHIPMENT,
      entityId: label.trackingNumber,
      after,
      extra: { clientEventId },
    });

    return NextResponse.json({ ok: true, ...after });
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
    return errorResponse(error, 'POST /api/shipping/labels');
  }
}, { permission: 'shipping.buy_label' });
