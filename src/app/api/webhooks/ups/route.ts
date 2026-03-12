import { NextRequest, NextResponse } from 'next/server';
import { parseUPSTrackingPayload } from '@/lib/shipping/providers/ups';
import { getShipmentByTracking, updateShipmentSummary, upsertShipment, upsertTrackingEvents } from '@/lib/shipping/repository';

function isAuthorized(req: NextRequest): boolean {
  const secret =
    process.env.UPS_WEBHOOK_BEARER ||
    process.env.UPS_WEBHOOK_SECRET ||
    '';

  if (!secret) return true;

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
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const packagePayloads = splitIntoPackagePayloads(payload);
  let processed = 0;
  const trackingNumbers: string[] = [];

  for (const packagePayload of packagePayloads) {
    const result = parseUPSTrackingPayload(packagePayload);
    if (!result?.trackingNumberNormalized) continue;

    const existing = await getShipmentByTracking(result.trackingNumberNormalized);
    const shipment = existing ?? await upsertShipment({
      trackingNumberRaw: result.trackingNumberNormalized,
      trackingNumberNormalized: result.trackingNumberNormalized,
      carrier: 'UPS',
      sourceSystem: 'ups_webhook',
    });

    await upsertTrackingEvents(
      shipment.id,
      'UPS',
      result.trackingNumberNormalized,
      result.events
    );
    await updateShipmentSummary(shipment.id, result);

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
