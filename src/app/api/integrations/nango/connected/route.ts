/**
 * POST /api/integrations/nango/connected
 *
 * Called by the admin UI after the Connect UI fires its `connect` event.
 * Persists a lightweight marker (no secret) in organization_integrations so
 * the integrations grid shows the connection and later proxy/token calls know
 * which Nango connection to use. Tokens stay inside Nango's own store.
 *
 * Body: { provider, connectionId, providerConfigKey, displayLabel? }
 *
 * The connectionId/providerConfigKey come from Nango's connect event payload;
 * we trust them only as far as the (org-scoped) marker — no credentials are
 * derived from the client here.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/withAuth';
import { isNangoConfigured, recordNangoConnection } from '@/lib/integrations/nango';
import { isNangoBackedProvider, nangoProviderConfigKey } from '@/lib/integrations/nango-providers';

const Body = z.object({
  provider: z.string().min(1).max(64),
  connectionId: z.string().min(1).max(256),
  providerConfigKey: z.string().min(1).max(128),
  displayLabel: z.string().max(160).nullable().optional(),
});

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
  // The provider config key must match what we registered — don't store a row
  // pointing at an arbitrary client-supplied integration.
  const expectedKey = nangoProviderConfigKey(parsed.provider);
  if (expectedKey !== parsed.providerConfigKey) {
    return NextResponse.json({ error: 'PROVIDER_KEY_MISMATCH' }, { status: 400 });
  }

  await recordNangoConnection({
    orgId: ctx.organizationId,
    provider: parsed.provider,
    connectionId: parsed.connectionId,
    providerConfigKey: parsed.providerConfigKey,
    displayLabel: parsed.displayLabel ?? null,
    createdBy: ctx.staffId,
  });

  return NextResponse.json({ status: 'ok' });
}, {
  permission: 'admin.manage_features',
  stepUp: true,
  audit: {
    source: 'admin',
    action: 'integration.nango.connected',
    entityType: 'integration',
    entityId: ({ body }) => (body as { provider?: string })?.provider ?? null,
  },
});
