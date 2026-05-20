/**
 * POST /api/admin/integrations/upsert
 *
 * Creates or replaces a per-tenant integration credential. Body shape:
 *   { provider: 'zoho', scope?: string, displayLabel?: string, payload: object }
 *
 * `payload` is whatever the integration module expects — see
 * src/lib/integrations/credentials.ts for the per-provider type shapes.
 * It's encrypted server-side with the org's vault key; the client never
 * sees ciphertext.
 *
 * Gated by admin.manage_features (these are global-impact credentials)
 * plus step-up to prevent CSRF-style replays.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/withAuth';
import {
  upsertIntegrationCredentials,
  type IntegrationProvider,
} from '@/lib/integrations/credentials';

const PROVIDERS = [
  'ebay', 'zoho', 'ecwid', 'square', 'ups', 'fedex', 'usps', 'zendesk',
  'google_sheets', 'ably', 'ollama', 'stripe',
] as const;

const Body = z.object({
  provider: z.enum(PROVIDERS),
  scope: z.string().max(64).nullable().optional(),
  displayLabel: z.string().max(160).nullable().optional(),
  payload: z.record(z.string(), z.unknown()),
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

  await upsertIntegrationCredentials({
    orgId: ctx.organizationId,
    provider: parsed.provider as IntegrationProvider,
    scope: parsed.scope ?? null,
    displayLabel: parsed.displayLabel ?? null,
    payload: parsed.payload,
    createdBy: ctx.staffId,
  });
  return NextResponse.json({ status: 'ok' });
}, {
  permission: 'admin.manage_features',
  stepUp: true,
  audit: {
    source: 'admin',
    action: 'integration.upsert',
    entityType: 'integration',
    entityId: ({ body }) => (body as { provider?: string })?.provider ?? null,
  },
});
