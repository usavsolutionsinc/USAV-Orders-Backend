import { NextResponse, type NextRequest } from 'next/server';
import { processZohoWebhook } from '@/lib/zoho/webhooks/process';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Zoho webhook receiver — LEGACY tokenless endpoint.
 *
 * Authenticated with the global env `ZOHO_WEBHOOK_SECRET` and attributed to the
 * transitional USAV org. Kept for back-compat until USAV migrates to its
 * per-tenant URL (/api/zoho/webhooks/{token}); new tenants MUST use the
 * per-tenant route so deliveries resolve to the correct org. All logic lives in
 * the shared pipeline (verify → resolve → dedupe → dispatch).
 *
 * Setup — see src/app/api/zoho/webhooks/README.md.
 */
export async function POST(request: NextRequest) {
  return processZohoWebhook(request, { token: null });
}

/**
 * Health check so you can curl the URL from Zoho's webhook tester before
 * turning real deliveries on. Returns the configured signature header name
 * (not the secret).
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    receiver: '/api/zoho/webhooks',
    mode: 'legacy-global-secret (USAV); use /api/zoho/webhooks/{token} for per-tenant',
    expected_signature_header:
      (process.env.ZOHO_WEBHOOK_SIGNATURE_HEADER || 'x-zoho-webhook-signature').toLowerCase(),
    encoding: (process.env.ZOHO_WEBHOOK_SIGNATURE_ENCODING || 'hex').toLowerCase(),
    secret_configured: Boolean(process.env.ZOHO_WEBHOOK_SECRET),
  });
}
