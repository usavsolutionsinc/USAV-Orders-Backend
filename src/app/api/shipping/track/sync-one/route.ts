import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitForOrg } from '@/lib/api-guard';
import { syncShipment } from '@/lib/shipping/sync-shipment';
import type { CarrierCode } from '@/lib/shipping/types';
import { withAuth } from '@/lib/auth/withAuth';

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const rate = await checkRateLimitForOrg({
    headers: req.headers,
    routeKey: 'shipping-sync-one',
    limit: 30,
    windowMs: 60_000,
    organizationId: ctx.organizationId,
  });
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: rate.retryAfterSec ? { 'Retry-After': String(rate.retryAfterSec) } : undefined }
    );
  }

  let body: { shipmentId?: number; trackingNumber?: string; carrier?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const shipmentId = body.shipmentId != null ? Number(body.shipmentId) : undefined;
  const trackingNumber = body.trackingNumber ? String(body.trackingNumber).trim() : undefined;

  if (!shipmentId && !trackingNumber) {
    return NextResponse.json(
      { error: 'Either shipmentId or trackingNumber is required' },
      { status: 400 }
    );
  }

  const carrierInput = body.carrier ? String(body.carrier).toUpperCase() : undefined;
  const validCarriers: CarrierCode[] = ['UPS', 'USPS', 'FEDEX'];
  const carrier = carrierInput && validCarriers.includes(carrierInput as CarrierCode)
    ? (carrierInput as CarrierCode)
    : undefined;

  // Session-authed route (withAuth + permission) — the only caller is the
  // ShipmentTab UI, so the tenant comes from ctx. (The tracking-poll cron uses
  // the syncShipment lib directly, not this endpoint.) syncShipment runs its
  // shipping-table reads/writes GUC-scoped (app.current_org) under this org.
  const orgId = ctx.organizationId;

  const result = await syncShipment({ shipmentId, trackingNumber, carrier }, orgId);

  if (!result.ok) {
    const status = result.errorCode === 'NOT_FOUND' ? 404
      : result.errorCode === 'RATE_LIMIT' ? 429
      : 500;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result);
}, { permission: 'shipping.mark_shipped' });
