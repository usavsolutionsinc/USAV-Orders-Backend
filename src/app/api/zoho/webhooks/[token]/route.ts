import { NextResponse, type NextRequest } from 'next/server';
import { processZohoWebhook } from '@/lib/zoho/webhooks/process';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ token: string }> };

/**
 * Per-tenant Zoho webhook receiver (Wave 3, production multi-tenant path).
 *
 *   POST /api/zoho/webhooks/{token}
 *
 * The opaque `token` (minted when the org connected Zoho) maps O(1) to exactly
 * one org via organization_integrations.webhook_token, and the delivery is
 * authenticated with THAT org's signing secret — so events resolve to the
 * correct tenant and a body forged with another tenant's key is rejected. All
 * logic lives in the shared pipeline.
 */
export async function POST(request: NextRequest, ctx: RouteCtx) {
  const { token } = await ctx.params;
  return processZohoWebhook(request, { token });
}

/** Health check — does NOT reveal whether the token is valid (opaque on purpose). */
export async function GET() {
  return NextResponse.json({
    ok: true,
    receiver: '/api/zoho/webhooks/{token}',
    mode: 'per-tenant (token-resolved org + per-org signing secret)',
  });
}
