import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { parseFedExTrackingPayload } from '@/lib/shipping/providers/fedex';
import { getShipmentByTracking, updateShipmentSummary, upsertShipment, upsertTrackingEvents } from '@/lib/shipping/repository';
import { publishShipmentStatusChange } from '@/lib/shipping/publish-on-status-change';
import { transitionalUsavOrgId } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

// FedEx signs each push with an HMAC-SHA256 digest (base64) of the raw request
// body keyed by the security token configured on the webhook project. The
// header name has varied across FedEx's webhook products, so we check the known
// variants. Override with FEDEX_WEBHOOK_SIGNATURE_HEADER if your project differs.
const SIGNATURE_HEADERS = [
  process.env.FEDEX_WEBHOOK_SIGNATURE_HEADER,
  'x-fdx-sc-signature',
  'fdx-signature',
  'x-fedex-signature',
].filter(Boolean) as string[];

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual throws on length mismatch — guard so a wrong-length
  // signature returns false instead of 500-ing.
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify the request against the webhook project's security token. Prefers
 * FedEx's real mechanism (HMAC-SHA256 over the raw body) and falls back to a
 * static bearer/header secret for local replay scripts. Returns true when no
 * secret is configured outside production so dev/preview keep working.
 */
function isAuthorized(req: NextRequest, rawBody: string): boolean {
  const secret =
    process.env.FEDEX_WEBHOOK_SECRET ||
    process.env.FEDEX_WEBHOOK_BEARER ||
    '';

  // Fail closed in production when no secret is configured. Permissive in
  // development/preview so local replay scripts and previews keep working
  // without forcing every dev to set the env var.
  if (!secret) return process.env.NODE_ENV !== 'production';

  // 1. HMAC-SHA256 signature (FedEx's real push mechanism).
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  for (const header of SIGNATURE_HEADERS) {
    const provided = req.headers.get(header);
    if (provided && constantTimeEquals(provided, expected)) return true;
  }

  // 2. Static bearer / header secret (manual replay & testing).
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
  // Read the raw body once — HMAC verification must hash the exact bytes FedEx
  // signed, so we can't let req.json() re-serialize first.
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

  const payloads = splitIntoTrackResultPayloads(payload);
  let processed = 0;
  const trackingNumbers: string[] = [];
  const orgId = transitionalUsavOrgId();

  for (const sub of payloads) {
    const result = parseFedExTrackingPayload(sub);
    if (!result?.trackingNumberNormalized) continue;

    const existing = await getShipmentByTracking(result.trackingNumberNormalized, orgId);
    const shipment = existing ?? await upsertShipment({
      trackingNumberRaw: result.trackingNumberNormalized,
      trackingNumberNormalized: result.trackingNumberNormalized,
      carrier: 'FEDEX',
      sourceSystem: 'fedex_webhook',
    }, orgId);

    const shipmentOrgId = (shipment.organization_id as OrgId | null) ?? orgId;

    await upsertTrackingEvents(
      shipment.id,
      'FEDEX',
      result.trackingNumberNormalized,
      result.events,
      shipmentOrgId,
    );
    await updateShipmentSummary(shipment.id, result, shipmentOrgId);
    await publishShipmentStatusChange(shipment.id, 'fedex-webhook', null, shipmentOrgId);

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
