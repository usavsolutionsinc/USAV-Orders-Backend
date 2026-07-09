/**
 * POST /api/webhooks/usps — USPS Tracking 3.2 webhook receiver.
 *
 * USPS pushes near-real-time tracking events here for numbers we subscribed via
 * usps-subscription.ts. Mirrors /api/webhooks/fedex exactly:
 *   • read the raw body once (so HMAC hashes the exact bytes USPS signed)
 *   • authenticate (HMAC-SHA256 signature, or shared-secret echo, or bearer)
 *   • split a multi-notification payload into single results
 *   • parse via the shared parseUSPSTrackingPayload (same parser as polling)
 *   • idempotent upsert through upsertTrackingEvents (ON CONFLICT DO NOTHING),
 *     so at-least-once duplicate deliveries are absorbed
 *   • respond 2xx fast
 *
 * Sample USPS notification payload (follows the modernized Tracking response;
 * confirm exact field names against the dev portal):
 *   {
 *     "trackingNumber": "9400100000000000000000",
 *     "statusCategory": "In Transit",
 *     "trackSummary": { "event": "Arrived at USPS Facility", "eventCode": "10",
 *                       "eventCity": "ATLANTA", "eventState": "GA",
 *                       "eventDate": "March 9, 2025", "eventTime": "8:00 am" },
 *     "trackDetail": [ { ...older events... } ]
 *   }
 * A single bare event or a `trackingEvents[]` array are also tolerated — see
 * parseUSPSTrackingPayload.
 *
 * ⚠️ USPS's exact callback auth scheme is unconfirmed (portal is JS-rendered).
 * We accept three mechanisms and override via env; confirm during sandbox test.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { parseUSPSTrackingPayload } from '@/lib/shipping/providers/usps';
import { getShipmentByTracking, updateShipmentSummary, upsertShipment, upsertTrackingEvents } from '@/lib/shipping/repository';
import { publishShipmentStatusChange } from '@/lib/shipping/publish-on-status-change';
import { transitionalUsavOrgId } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

// USPS may echo the shared secret in a header, or sign the body. Header names
// aren't pinned down publicly; check known variants + an override.
const SECRET_HEADERS = [
  process.env.USPS_WEBHOOK_SECRET_HEADER,
  'x-usps-secret',
  'x-usps-credential',
].filter(Boolean) as string[];

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual throws on length mismatch — guard so a wrong-length value
  // returns false instead of 500-ing.
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify the request against USPS_WEBHOOK_SECRET. Tries, in order: HMAC-SHA256
 * (base64) over the raw body, a shared-secret header echo, the secret embedded
 * in the parsed body, then a static bearer (for replay/testing). Permissive
 * when no secret is set outside production so local replay keeps working.
 */
function isAuthorized(req: NextRequest, rawBody: string, parsed: any): boolean {
  const secret =
    process.env.USPS_WEBHOOK_SECRET ||
    process.env.USPS_WEBHOOK_BEARER ||
    '';

  if (!secret) return process.env.NODE_ENV !== 'production';

  // 1. HMAC-SHA256 signature over the raw body.
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  const sigHeader = req.headers.get(process.env.USPS_WEBHOOK_SIGNATURE_HEADER || 'x-usps-signature');
  if (sigHeader && constantTimeEquals(sigHeader, expected)) return true;

  // 2. Shared-secret echo header.
  for (const header of SECRET_HEADERS) {
    const provided = req.headers.get(header);
    if (provided && constantTimeEquals(provided, secret)) return true;
  }

  // 3. Shared secret echoed in the body (we send `sharedSecret` on subscribe).
  if (parsed?.sharedSecret && constantTimeEquals(String(parsed.sharedSecret), secret)) return true;

  // 4. Static bearer / header secret (manual replay & testing).
  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${secret}`) return true;
  if (req.headers.get('x-webhook-secret') === secret) return true;

  return false;
}

// USPS may deliver one notification or many. Normalise to an array of
// individually-parseable payloads. Handles: top-level array, `{notifications:[]}`,
// `{trackingNotifications:[]}`, or a single object.
function splitIntoNotifications(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  const list = payload?.notifications ?? payload?.trackingNotifications ?? payload?.events;
  if (Array.isArray(list)) return list;
  return [payload];
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isAuthorized(req, rawBody, payload)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const notifications = splitIntoNotifications(payload);
  let processed = 0;
  const trackingNumbers: string[] = [];
  const orgId = transitionalUsavOrgId();

  for (const note of notifications) {
    const result = parseUSPSTrackingPayload(note);
    if (!result?.trackingNumberNormalized) continue;

    const existing = await getShipmentByTracking(result.trackingNumberNormalized, orgId);
    const shipment = existing ?? await upsertShipment({
      trackingNumberRaw: result.trackingNumberNormalized,
      trackingNumberNormalized: result.trackingNumberNormalized,
      carrier: 'USPS',
      sourceSystem: 'usps_webhook',
    }, orgId);

    const shipmentOrgId = (shipment.organization_id as OrgId | null) ?? orgId;

    await upsertTrackingEvents(
      shipment.id,
      'USPS',
      result.trackingNumberNormalized,
      result.events,
      shipmentOrgId,
    );
    await updateShipmentSummary(shipment.id, result, shipmentOrgId);
    await publishShipmentStatusChange(shipment.id, 'usps-webhook', null, shipmentOrgId);

    processed += 1;
    trackingNumbers.push(result.trackingNumberNormalized);
  }

  console.log('[webhook.usps]', { received: notifications.length, processed, trackingNumbers });

  return NextResponse.json({ ok: true, processed, trackingNumbers });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    carrier: 'USPS',
    callbackPath: '/api/webhooks/usps',
  });
}
