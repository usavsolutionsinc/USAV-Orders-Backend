/**
 * POST /api/integrations/nango/session
 *
 * Mints a short-lived Nango Connect session token for the caller's tenant so
 * the browser can open the hosted Connect UI (OAuth dance) for a Nango-backed
 * provider. No secret ever reaches the client beyond this single-use token.
 *
 * Body: { provider: 'square' }   // must be a NANGO_BACKED provider
 *
 * Gated by admin.manage_features + step-up, matching the credential-upsert
 * route — connecting an integration is the same class of action.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/withAuth';
import { assertCanConnectProvider } from '@/lib/integrations/connectors/connections';
import { isNangoConfigured, createNangoConnectSession, nangoProviderConfigKey } from '@/lib/integrations/nango';
import { isNangoBackedProvider } from '@/lib/integrations/nango-providers';

const Body = z.object({ provider: z.string().min(1).max(64) });

export const POST = withAuth(async (req, ctx) => {
  if (!isNangoConfigured()) {
    return NextResponse.json({ error: 'NANGO_NOT_CONFIGURED' }, { status: 503 });
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'INVALID_INPUT', detail: err instanceof Error ? err.message : 'bad request' },
      { status: 400 },
    );
  }

  if (!isNangoBackedProvider(parsed.provider)) {
    return NextResponse.json({ error: 'PROVIDER_NOT_NANGO_BACKED', provider: parsed.provider }, { status: 400 });
  }
  const providerConfigKey = nangoProviderConfigKey(parsed.provider);
  if (!providerConfigKey) {
    return NextResponse.json({ error: 'PROVIDER_NOT_NANGO_BACKED', provider: parsed.provider }, { status: 400 });
  }

  // Plan ceiling: connecting a NEW provider must fit the org's maxIntegrations.
  // (parsed.provider is narrowed to IntegrationProvider by isNangoBackedProvider.)
  const refusal = await assertCanConnectProvider(ctx.organizationId, parsed.provider);
  if (refusal) return NextResponse.json(refusal, { status: 403 });

  const session = await createNangoConnectSession({
    orgId: ctx.organizationId,
    providerConfigKey,
  });

  return NextResponse.json({ token: session.token, expiresAt: session.expiresAt });
}, {
  permission: 'admin.manage_features',
  stepUp: true,
  audit: {
    source: 'admin',
    action: 'integration.nango.session',
    entityType: 'integration',
    entityId: ({ body }) => (body as { provider?: string })?.provider ?? null,
  },
});
