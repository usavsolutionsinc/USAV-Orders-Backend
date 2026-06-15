import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { parseUPSTrackingPayload } from '@/lib/shipping/providers/ups';
import { getShipmentByTracking, updateShipmentSummary, upsertShipment, upsertTrackingEvents } from '@/lib/shipping/repository';
import { publishShipmentStatusChange } from '@/lib/shipping/publish-on-status-change';
import { transitionalUsavOrgId } from '@/lib/tenancy/db';

// UPS authenticates callbacks via the credential we registered on the
// subscription, echoed back in a header. Header name has varied; check the
// known variants and allow an override. We also accept an HMAC-SHA256 (base64)
// digest of the raw body for parity with the FedEx receiver.
const CREDENTIAL_HEADERS = [
  process.env.UPS_WEBHOOK_CREDENTIAL_HEADER,
  'credential',
  'x-ups-credential',
].filter(Boolean) as string[];

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function isAuthorized(req: NextRequest, rawBody: string): boolean {
  const secret =
    process.env.UPS_WEBHOOK_SECRET ||
    process.env.UPS_WEBHOOK_BEARER ||
    '';

  // Fail closed in production when no secret is configured. Permissive in
  // development/preview so local replay scripts and previews keep working
  // without forcing every dev to set the env var.
  if (!secret) return process.env.NODE_ENV !== 'production';

  // 1. Credential echo (UPS's documented callback auth).
  for (const header of CREDENTIAL_HEADERS) {
    const provided = req.headers.get(header);
    if (provided && constantTimeEquals(provided, secret)) return true;
  }

  // 2. HMAC-SHA256 signature over the raw body (parity with FedEx).
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  const sig = req.headers.get('x-ups-signature');
  if (sig && constantTimeEquals(sig, expected)) return true;

  // 3. Static bearer / header secret (manual replay & testing).
  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${secret}`) return true;
  if (req.headers.get('x-webhook-secret') === secret) return true;

  return false;
}

function splitIntoPackagePayloads(payload: any): any[] {
  const shipments = Array.isArray(payload?.trackResponse?.shipment)
    ? payload.trackResponse.shipment
    : payload?.trackResponse?.shipment
      ? [payload.trackResponse.shipment]
      : [];

  if (shipments.length === 0) return [payload];

  const packagePayloads: any[] = [];
  for (const shipment of shipments) {
    const packages = Array.isArray(shipment?.package)
      ? shipment.package
      : shipment?.package
        ? [shipment.package]
        : [];

    if (packages.length === 0) {
      packagePayloads.push(payload);
      continue;
    }

    for (const pkg of packages) {
      packagePayloads.push({
        ...payload,
        trackResponse: {
          ...(payload?.trackResponse ?? {}),
          shipment: [
            {
              ...shipment,
              package: [pkg],
            },
          ],
        },
      });
    }
  }

  return packagePayloads;
}

export async function POST(req: NextRequest) {
  // Read the raw body once so HMAC verification hashes the exact bytes UPS sent.
  const rawBody = await req.text();

  if (!isAuthorized(req, rawBody)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // TRANSITIONAL: UPS carrier callbacks have no session. Single-tenant (USAV)
  // today; resolve the org from the shipment / linked order when inbound
  // shipping_tracking_numbers carries organization_id (Phase B). Thread it into
  // every repository + publish call so they run GUC-scoped (app.current_org).
  // shipping_tracking_numbers / shipment_tracking_events are tenant-owned-NEEDS-COL
  // (no organization_id column, no org-bearing parent reachable here) — per the
  // tenant-isolation pattern rule (6) these calls can only GUC-wrap for now, not
  // add an explicit organization_id predicate/stamp; the wrap makes them RLS-ready
  // once the columns + FORCE policy land.
  const orgId = transitionalUsavOrgId();

  const packagePayloads = splitIntoPackagePayloads(payload);
  let processed = 0;
  const trackingNumbers: string[] = [];

  for (const packagePayload of packagePayloads) {
    const result = parseUPSTrackingPayload(packagePayload);
    if (!result?.trackingNumberNormalized) continue;

    const existing = await getShipmentByTracking(result.trackingNumberNormalized, orgId);
    const shipment = existing ?? await upsertShipment({
      trackingNumberRaw: result.trackingNumberNormalized,
      trackingNumberNormalized: result.trackingNumberNormalized,
      carrier: 'UPS',
      sourceSystem: 'ups_webhook',
    }, orgId);

    await upsertTrackingEvents(
      shipment.id,
      'UPS',
      result.trackingNumberNormalized,
      result.events,
      orgId
    );
    await updateShipmentSummary(shipment.id, result, orgId);
    // Pass trackingNumber=null to preserve the pre-migration published payload
    // shape (it was undefined before); only orgId scoping is added here.
    await publishShipmentStatusChange(shipment.id, 'ups-webhook', null, orgId);

    processed += 1;
    trackingNumbers.push(result.trackingNumberNormalized);
  }

  return NextResponse.json({
    ok: true,
    processed,
    trackingNumbers,
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    carrier: 'UPS',
    callbackPath: '/api/webhooks/ups',
  });
}
