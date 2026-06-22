/**
 * Canonical Zoho webhook pipeline (Wave 3). Both the per-tenant route
 * (/api/zoho/webhooks/{token}) and the legacy tokenless route
 * (/api/zoho/webhooks) delegate here so the security ordering is identical:
 *
 *   resolve org (+ pick secret) → verify HMAC on raw body → parse → normalize
 *   → cross-check Zoho account → reserve (org-scoped dedupe) → dispatch.
 *
 * Org resolution happens BEFORE verification because the signing secret is
 * per-tenant. Idempotent + replay-safe: the dedupe ledger is keyed on
 * (organization_id, event_id); a re-delivery short-circuits with 200.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { verifyZohoWebhookSignature } from './verify';
import { normalizeZohoWebhook } from './normalize';
import { resolveOrgFromWebhook, assertEventFromOrgZohoAccount } from './resolve-org';
import {
  reserveWebhookEvent,
  markWebhookEventProcessed,
  markWebhookEventFailed,
} from './dedupe';
import { dispatchWebhookEvent } from './handlers';
import type { ZohoWebhookEnvelope } from './types';

export async function processZohoWebhook(
  request: NextRequest,
  params: { token?: string | null } = {},
): Promise<NextResponse> {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ ok: false, error: 'failed to read request body' }, { status: 400 });
  }

  // 1. Resolve the tenant (and its signing secret) from the URL token, before
  //    we trust anything in the body.
  const resolved = await resolveOrgFromWebhook({ token: params.token });
  if (!resolved.ok) {
    // Opaque to the sender; reason logged server-side only.
    console.warn('[zoho-webhook] org resolution failed:', resolved.reason);
    return NextResponse.json({ ok: false, error: 'unrecognized webhook endpoint' }, { status: resolved.status });
  }
  const { orgId } = resolved;

  // 2. Authenticate the raw body against THIS org's secret (per-tenant) or the
  //    global env secret (legacy USAV path).
  const verification = verifyZohoWebhookSignature(rawBody, request.headers, {
    secret: resolved.signingSecret,
  });
  if (!verification.ok) {
    console.warn(`[zoho-webhook] signature verification failed (org ${orgId}, ${resolved.source}):`, verification.reason);
    return NextResponse.json({ ok: false, error: 'signature verification failed' }, { status: 401 });
  }

  // 3. Parse + normalize.
  let envelope: ZohoWebhookEnvelope;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: 'body is not JSON' }, { status: 400 });
  }
  const event = normalizeZohoWebhook(envelope);

  // 4. Cross-check the event is from the Zoho account this org connected
  //    (defense-in-depth; no-op when the envelope omits organization_id).
  const belongs = await assertEventFromOrgZohoAccount(orgId, event);
  if (!belongs.ok) {
    console.warn(`[zoho-webhook] account cross-check failed (org ${orgId}):`, belongs.reason);
    return NextResponse.json({ ok: false, error: 'event does not belong to this tenant' }, { status: 403 });
  }

  // 5. Org-scoped dedupe reservation — replay-safe.
  let reservation;
  try {
    reservation = await reserveWebhookEvent(event, orgId);
  } catch (err) {
    console.error('[zoho-webhook] dedupe insert failed', err);
    return NextResponse.json({ ok: false, error: 'dedupe storage unavailable' }, { status: 500 });
  }
  if (!reservation.isFresh) {
    return NextResponse.json({
      ok: true,
      deduped: true,
      event_id: event.eventId,
      event_type: event.eventType,
    });
  }

  // 6. Dispatch. Handler errors → 500 so Zoho retries; we clear processed_at so
  //    the retry knows work remains.
  try {
    const result = await dispatchWebhookEvent(event, orgId);
    await markWebhookEventProcessed(orgId, event.eventId);
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
    console.error('[zoho-webhook] handler failed', orgId, event.eventId, event.eventType, err);
    await markWebhookEventFailed(orgId, event.eventId, err).catch(() => {});
    return NextResponse.json(
      { ok: false, event_id: event.eventId, event_type: event.eventType, error: message },
      { status: 500 },
    );
  }
}
