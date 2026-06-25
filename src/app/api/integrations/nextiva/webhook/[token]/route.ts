import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getIntegrationCredentials, type NextivaCredentials } from '@/lib/integrations/credentials';
import { resolveOrgByNextivaWebhookToken } from '@/lib/voice/nextiva/webhook-identity';
import { verifyNextivaWebhookSignature } from '@/lib/voice/nextiva/verify';
import { normalizeNextivaWebhook } from '@/lib/voice/nextiva/normalize-webhook';
import { recordCallEvent, recordVoicemail } from '@/lib/voice/ingest';
import { publishVoiceEvent } from '@/lib/realtime/publish';
import type { OrgId } from '@/lib/tenancy/constants';

export const dynamic = 'force-dynamic';

/**
 * POST /api/integrations/nextiva/webhook/:token
 *
 * Nextiva call/voicemail webhook receiver. Unauthenticated (no session) but
 * gated by:
 *   1. token → org      (O(1) via the indexed webhook_token column)
 *   2. HMAC signature    (per-tenant secret; raw body)
 * then a thin, idempotent upsert (UNIQUE(org, provider, external_*_id)) so a
 * re-delivery is a no-op. Returns 2xx fast; the realtime nudge is fire-and-forget.
 *
 * Anonymous-but-gated is the canonical webhook shape (mirrors the Zoho receiver).
 */

function tokenFromUrl(req: NextRequest): string {
  const segs = req.nextUrl.pathname.split('/').filter(Boolean);
  const i = segs.lastIndexOf('webhook');
  return decodeURIComponent(segs[i + 1] || '').trim();
}

export const POST = withAuth(
  async (req: NextRequest) => {
    const token = tokenFromUrl(req);
    if (!token) return NextResponse.json({ error: 'missing token' }, { status: 404 });

    const orgId = await resolveOrgByNextivaWebhookToken(token);
    if (!orgId) return NextResponse.json({ error: 'unknown token' }, { status: 404 });

    // Read the RAW body once — required for signature verification.
    const rawBody = await req.text();

    const creds = await getIntegrationCredentials<NextivaCredentials>(orgId, 'nextiva');
    const verdict = verifyNextivaWebhookSignature(rawBody, req.headers, {
      secret: creds?.webhookSigningSecret,
    });
    if (!verdict.ok) {
      // Opaque to the caller; logged server-side.
      console.warn(`[nextiva.webhook] signature rejected for org ${orgId}: ${verdict.reason}`);
      return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
    }

    let payload: unknown;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return NextResponse.json({ error: 'invalid json' }, { status: 400 });
    }

    const { calls, voicemails } = normalizeNextivaWebhook(payload);

    // Idempotent upserts. Errors per-item are logged but never fail the 2xx —
    // Nextiva would otherwise retry the whole batch.
    const touched = { calls: 0, voicemails: 0 } as { calls: number; voicemails: number };
    for (const c of calls) {
      try {
        await recordCallEvent(orgId as OrgId, c);
        touched.calls += 1;
      } catch (err) {
        console.error('[nextiva.webhook] call ingest failed:', err instanceof Error ? err.message : err);
      }
    }
    for (const vm of voicemails) {
      try {
        await recordVoicemail(orgId as OrgId, vm);
        touched.voicemails += 1;
      } catch (err) {
        console.error('[nextiva.webhook] voicemail ingest failed:', err instanceof Error ? err.message : err);
      }
    }

    // Fire-and-forget realtime nudge so the open Support tabs refetch.
    if (touched.calls > 0) {
      void publishVoiceEvent({ organizationId: orgId, kind: 'call', change: 'created' }).catch(() => {});
    }
    if (touched.voicemails > 0) {
      void publishVoiceEvent({ organizationId: orgId, kind: 'voicemail', change: 'created' }).catch(() => {});
    }

    return NextResponse.json({ ok: true, ...touched });
  },
  { allowAnonymous: true },
);
