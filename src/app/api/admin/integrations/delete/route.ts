/**
 * POST /api/admin/integrations/delete
 *
 * Removes a tenant's integration row. Same gating as upsert.
 *
 * Body: { provider, scope?: string }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/withAuth';
import { deleteIntegrationCredentials, type IntegrationProvider } from '@/lib/integrations/credentials';

const PROVIDERS = [
  'ebay', 'zoho', 'ecwid', 'square', 'ups', 'fedex', 'usps', 'zendesk',
  'google_sheets', 'ably', 'ollama', 'stripe',
] as const;

const Body = z.object({
  provider: z.enum(PROVIDERS),
  scope: z.string().max(64).nullable().optional(),
});

export const POST = withAuth(async (req, ctx) => {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'INVALID_INPUT', detail: err instanceof Error ? err.message : 'bad request' },
      { status: 400 },
    );
  }
  await deleteIntegrationCredentials(
    ctx.organizationId,
    parsed.provider as IntegrationProvider,
    parsed.scope ?? null,
  );
  return NextResponse.json({ status: 'ok' });
}, {
  permission: 'admin.manage_features',
  stepUp: true,
  audit: {
    source: 'admin',
    action: 'integration.delete',
    entityType: 'integration',
    entityId: ({ body }) => (body as { provider?: string })?.provider ?? null,
  },
});
