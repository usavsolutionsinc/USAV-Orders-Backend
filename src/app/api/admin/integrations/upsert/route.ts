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

import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/withAuth';
import {
  upsertIntegrationCredentials,
  type IntegrationProvider,
} from '@/lib/integrations/credentials';
import {
  wouldExceedIntegrationLimit,
  integrationLimitStatus,
} from '@/lib/integrations/connectors/connections';

const PROVIDERS = [
  'ebay', 'zoho', 'ecwid', 'square', 'ups', 'fedex', 'usps', 'zendesk',
  'google_sheets', 'ably', 'ollama', 'stripe',
  // AI search providers (per-org BYOK) — read by src/lib/ai/org-provider.ts
  'ai_gateway', 'openai', 'anthropic',
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

  // Entitlement ceiling: connecting a NEW provider can't push the org past its
  // plan's maxIntegrations. Updating an already-connected provider is allowed.
  if (await wouldExceedIntegrationLimit(ctx.organizationId, parsed.provider as IntegrationProvider)) {
    const limit = await integrationLimitStatus(ctx.organizationId);
    return NextResponse.json(
      {
        error: 'INTEGRATION_LIMIT',
        used: limit.used,
        max: limit.max,
        hint: 'Upgrade your plan to connect more integrations.',
      },
      { status: 402 },
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

  // AI provider connected/switched → the org's search docs must re-embed in
  // the new model's embedding space (mixed models poison cosine relevance).
  // Enqueue-only + fire-and-forget; the search-outbox cron drains at its pace.
  if (['ai_gateway', 'openai', 'anthropic', 'ollama'].includes(parsed.provider)) {
    after(async () => {
      try {
        const { enqueueOrgReembed } = await import('@/lib/search/search-outbox-worker');
        const n = await enqueueOrgReembed(ctx.organizationId);
        console.info(`[integrations] AI provider changed — re-embed enqueued for ${n} docs`);
      } catch (err) {
        console.warn('[integrations] re-embed enqueue failed (non-fatal):', err);
      }
    });
  }
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
