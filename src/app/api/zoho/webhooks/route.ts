import { NextResponse, type NextRequest } from 'next/server';
import { verifyZohoWebhookSignature } from '@/lib/zoho/webhooks/verify';
import { normalizeZohoWebhook } from '@/lib/zoho/webhooks/normalize';
import {
  reserveWebhookEvent,
  markWebhookEventProcessed,
  markWebhookEventFailed,
} from '@/lib/zoho/webhooks/dedupe';
import { dispatchWebhookEvent } from '@/lib/zoho/webhooks/handlers';
import type { ZohoWebhookEnvelope } from '@/lib/zoho/webhooks/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Zoho webhook receiver. One endpoint, one event per request, signature
 * verified, deduped, then routed.
 *
 * Setup — see src/app/api/zoho/webhooks/README.md for the full Zoho-side
 * registration walk-through.
 *
 *   POST /api/zoho/webhooks
 *   Headers: x-zoho-webhook-signature: <hex hmac-sha256 of raw body>
 *   Body:    JSON envelope (Inventory: `{ event_type, data: { purchaseorder: {...} } }`)
 *
 * Response shape on every code path:
 *   200 OK  → { ok: true, event_id, event_type, action, detail?, deduped?, skipped? }
 *   401     → signature missing / mismatch — Zoho will retry.
 *   400     → body unparseable.
 *   500     → handler threw. Event remains un-processed; Zoho will retry; on
 *             retry the dedupe row already exists, so reprocessing skips the
 *             insert but re-runs the handler.
 *
 * Why we read the body twice: signature verification requires the *raw* bytes
 * (whitespace + key order matter for HMAC), so we read text first then
 * `JSON.parse` ourselves.
 */
export async function POST(request: NextRequest) {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'failed to read request body' },
      { status: 400 },
    );
  }

  // 1. Verify signature on the raw body. Mismatches: 401 (Zoho retries).
  const verification = verifyZohoWebhookSignature(rawBody, request.headers);
  if (!verification.ok) {
    console.warn('[zoho-webhook] signature verification failed:', verification.reason);
    return NextResponse.json(
      { ok: false, error: 'signature verification failed' },
      { status: 401 },
    );
  }

  // 2. Parse JSON. Malformed body shouldn't trigger Zoho retries (200 with skip).
  let envelope: ZohoWebhookEnvelope;
  try {
    envelope = JSON.parse(rawBody);
  } catch (err) {
    console.warn('[zoho-webhook] body is not JSON');
    return NextResponse.json(
      { ok: false, error: 'body is not JSON' },
      { status: 400 },
    );
  }

  // 3. Normalize: figure out event type, object id, and stable event_id.
  const event = normalizeZohoWebhook(envelope);

  // 4. Reserve the event_id. If already present, this is a re-delivery —
  //    return 200 fast so Zoho stops retrying.
  let reservation;
  try {
    reservation = await reserveWebhookEvent(event);
  } catch (err) {
    console.error('[zoho-webhook] dedupe insert failed', err);
    // Without dedupe we'd risk processing duplicates — fail the request so
    // Zoho retries, by which point either the DB recovered or someone fixed it.
    return NextResponse.json(
      { ok: false, error: 'dedupe storage unavailable' },
      { status: 500 },
    );
  }

  if (!reservation.isFresh) {
    return NextResponse.json({
      ok: true,
      deduped: true,
      event_id: event.eventId,
      event_type: event.eventType,
    });
  }

  // 5. Dispatch to the matching handler. Handler errors → 500 so Zoho retries,
  //    and we wipe processed_at so we know on the retry that work still remains.
  try {
    const result = await dispatchWebhookEvent(event);
    await markWebhookEventProcessed(event.eventId);
    return NextResponse.json({
      ok: true,
      event_id: event.eventId,
      event_type: event.eventType,
      action: result.action,
      detail: result.detail,
      skipped: result.skipped ?? false,
    });
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error('[zoho-webhook] handler failed', event.eventId, event.eventType, err);
    await markWebhookEventFailed(event.eventId, err).catch(() => {});
    return NextResponse.json(
      {
        ok: false,
        event_id: event.eventId,
        event_type: event.eventType,
        error: message,
      },
      { status: 500 },
    );
  }
}

/**
 * Tiny health check so you can curl the URL from Zoho's webhook tester
 * before turning real deliveries on. Returns the configured signature
 * header name (not the secret).
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    receiver: '/api/zoho/webhooks',
    expected_signature_header:
      (process.env.ZOHO_WEBHOOK_SIGNATURE_HEADER || 'x-zoho-webhook-signature').toLowerCase(),
    encoding: (process.env.ZOHO_WEBHOOK_SIGNATURE_ENCODING || 'hex').toLowerCase(),
    secret_configured: Boolean(process.env.ZOHO_WEBHOOK_SECRET),
  });
}
