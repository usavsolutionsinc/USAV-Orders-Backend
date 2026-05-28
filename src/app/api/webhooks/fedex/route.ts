import { NextRequest, NextResponse } from 'next/server';
import { parseFedExTrackingPayload } from '@/lib/shipping/providers/fedex';
import { getShipmentByTracking, updateShipmentSummary, upsertShipment, upsertTrackingEvents } from '@/lib/shipping/repository';
import { publishShipmentStatusChange } from '@/lib/shipping/publish-on-status-change';

function isAuthorized(req: NextRequest): boolean {
  const secret =
    process.env.FEDEX_WEBHOOK_BEARER ||
    process.env.FEDEX_WEBHOOK_SECRET ||
    '';

  // Fail closed in production when no secret is configured. Permissive in
  // development/preview so local replay scripts and previews keep working
  // without forcing every dev to set the env var.
  if (!secret) return process.env.NODE_ENV !== 'production';

  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${secret}`) return true;

  if (req.headers.get('x-webhook-secret') === secret) return true;

  return false;
}

// FedEx Track Notifications deliver `output.completeTrackResults[].trackResults[]`.
// Split each (group, result) pair into its own single-result payload so the
// downstream parser (which only looks at `[0][0]`) processes every package.
function splitIntoTrackResultPayloads(payload: any): any[] {
  const groups = Array.isArray(payload?.output?.completeTrackResults)
    ? payload.output.completeTrackResults
    : payload?.output?.completeTrackResults
      ? [payload.output.completeTrackResults]
      : [];

  if (groups.length === 0) return [payload];

  const out: any[] = [];
  for (const group of groups) {
    const trackResults = Array.isArray(group?.trackResults)
      ? group.trackResults
      : group?.trackResults
        ? [group.trackResults]
        : [];

    if (trackResults.length === 0) {
      out.push({
        ...payload,
        output: {
          ...(payload?.output ?? {}),
          completeTrackResults: [group],
        },
      });
      continue;
    }

    for (const tr of trackResults) {
      out.push({
        ...payload,
        output: {
          ...(payload?.output ?? {}),
          completeTrackResults: [
            {
              ...group,
              trackingNumber: group?.trackingNumber ?? tr?.trackingNumberInfo?.trackingNumber ?? null,
              trackResults: [tr],
            },
          ],
        },
      });
    }
  }

  return out;
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

  const payloads = splitIntoTrackResultPayloads(payload);
  let processed = 0;
  const trackingNumbers: string[] = [];

  for (const sub of payloads) {
    const result = parseFedExTrackingPayload(sub);
    if (!result?.trackingNumberNormalized) continue;

    const existing = await getShipmentByTracking(result.trackingNumberNormalized);
    const shipment = existing ?? await upsertShipment({
      trackingNumberRaw: result.trackingNumberNormalized,
      trackingNumberNormalized: result.trackingNumberNormalized,
      carrier: 'FEDEX',
      sourceSystem: 'fedex_webhook',
    });

    await upsertTrackingEvents(
      shipment.id,
      'FEDEX',
      result.trackingNumberNormalized,
      result.events
    );
    await updateShipmentSummary(shipment.id, result);
    await publishShipmentStatusChange(shipment.id, 'fedex-webhook');

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
    carrier: 'FEDEX',
    callbackPath: '/api/webhooks/fedex',
  });
}
