import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';
import type { OrgId } from '@/lib/tenancy/constants';
import {
  getShipStationV2,
  resolveShipFrom,
  ShipFromNotConfiguredError,
  ShipStationNotConnectedError,
} from '@/lib/shipping/shipstation/config';
import { ShipStationApiError } from '@/lib/shipping/shipstation/client';
import { buildShipmentSpec, RatesBodySchema } from '@/lib/shipping/shipstation/rate-request';

export const dynamic = 'force-dynamic';

/**
 * POST /api/shipping/rates — operator rate-shop from an explicit shipment spec.
 *
 * Unlike /api/outbound/rates (order-anchored), this takes the full shipment
 * (ship-to address, parcels/dims/weight) in the body — the generic engine
 * entry the station builder's rate-shop action drives. `shipFrom` omitted →
 * the org's warehouse origin. Read-only: no DB mutation, no label purchased,
 * so no audit row.
 *
 * Missing per-org ShipStation credentials → 409 { error: 'NOT_CONNECTED' }
 * (keys are owner-gated; the UI teaches "connect ShipStation" instead of
 * failing opaquely).
 *
 * Body: RatesBodySchema (src/lib/shipping/shipstation/rate-request.ts).
 * Returns the normalized RateQuoteResult.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const orgId = ctx.organizationId as OrgId;
    const raw = await req.json().catch(() => null);
    const parsed = RatesBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Invalid body', issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Resolve the warehouse origin only when the body doesn't carry one.
    const fallbackShipFrom = parsed.data.shipFrom ? null : await resolveShipFrom(orgId);
    const spec = buildShipmentSpec(parsed.data, fallbackShipFrom ?? parsed.data.shipFrom!);

    const client = await getShipStationV2(orgId);
    const result = await client.getRates(spec);

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ShipStationNotConnectedError) {
      return NextResponse.json(
        { ok: false, error: 'NOT_CONNECTED', message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof ShipFromNotConfiguredError) {
      return NextResponse.json(
        { ok: false, error: 'SHIP_FROM_NOT_CONFIGURED', message: error.message },
        { status: 400 },
      );
    }
    if (error instanceof ShipStationApiError) {
      // 401/403 from the engine = the stored key is invalid → same teaching
      // state as no key at all.
      if (error.isNotConnected) {
        return NextResponse.json(
          { ok: false, error: 'NOT_CONNECTED', message: error.message },
          { status: 409 },
        );
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
    }
    return errorResponse(error, 'POST /api/shipping/rates');
  }
}, { permission: 'shipping.buy_label' });
