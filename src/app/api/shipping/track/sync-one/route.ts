import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/api-guard';
import { syncShipment } from '@/lib/shipping/sync-shipment';
import type { CarrierCode } from '@/lib/shipping/types';
import { withAuth } from '@/lib/auth/withAuth';
import { transitionalUsavOrgId } from '@/lib/tenancy/db';

export const POST = withAuth(async (req: NextRequest) => {
  const rate = checkRateLimit({
    headers: req.headers,
    routeKey: 'shipping-sync-one',
    limit: 30,
    windowMs: 60_000,
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

  // TRANSITIONAL: this manual sync endpoint is also driven by the carrier-tracking
  // polling cron, which has no session (no ctx.organizationId). Single-tenant
  // (USAV) today; resolve the service org and pass it into syncShipment so its
  // shipping-table reads/writes run GUC-scoped (app.current_org). The shipping
  // tables are NEEDS-COL (no organization_id yet), so this only sets the GUC —
  // RLS-ready once the columns + FORCE policy land.
  // TODO(multi-tenant): resolve org from the shipment / linked order (per-connection
  // mapping) instead of the USAV service org.
  // (no-restricted-syntax tenancy guard turned off for this file via the
  // burn-down allowlist in eslint.config.mjs — delete that entry when refactored.)
  const orgId = transitionalUsavOrgId();

  const result = await syncShipment({ shipmentId, trackingNumber, carrier }, orgId);

  if (!result.ok) {
    const status = result.errorCode === 'NOT_FOUND' ? 404
      : result.errorCode === 'RATE_LIMIT' ? 429
      : 500;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result);
}, { permission: 'shipping.mark_shipped' });
