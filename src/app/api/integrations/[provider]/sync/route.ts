/**
 * POST /api/integrations/[provider]/sync — "Sync now" for the caller's org.
 *
 * Runs the connector's wired sync() (connection-driven ingestion). Replaces the
 * ad-hoc transfer-orders / backfill buttons with a per-connection action.
 * 400 when the provider has no sync capability; 403 without the provider's
 * manage permission.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/withAuth';
import { getConnector } from '@/lib/integrations/connectors/registry';
import { syncConnection } from '@/lib/integrations/connectors/orchestrator';
import type { IntegrationProvider } from '@/lib/integrations/credentials';
import type { PermissionString } from '@/lib/auth/permissions';
import { wouldExceedPlanCeiling, planLimitResponseBody } from '@/lib/billing/plan-ceilings';

function managePermission(provider: string): PermissionString {
  if (provider === 'ebay') return 'integrations.ebay';
  if (provider === 'amazon') return 'integrations.amazon';
  if (provider === 'zoho') return 'integrations.zoho';
  // Order-import sources whose sync replaces the legacy transfer-orders
  // buttons (INT-020) keep the permission those buttons required, so the
  // Unshipped sidebar's importers don't silently start 403ing operators.
  if (provider === 'google_sheets' || provider === 'ecwid') return 'orders.import';
  return 'admin.manage_features';
}

/** Optional body — provider-specific manual-sync options. */
const BodySchema = z
  .object({
    manualSheetName: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const POST = withAuth(async (req, ctx) => {
  const segments = req.nextUrl.pathname.split('/').filter(Boolean);
  const provider = segments[segments.indexOf('integrations') + 1] as IntegrationProvider;

  const connector = getConnector(provider);
  if (!connector?.sync) {
    return NextResponse.json({ error: 'NO_SYNC', provider }, { status: 400 });
  }
  const perm = managePermission(provider);
  if (!ctx.permissions.has(perm)) {
    return NextResponse.json({ error: 'FORBIDDEN', permission: perm }, { status: 403 });
  }

  // Soft plan ceiling: button-driven "Sync now" is an order-ingestion entry, so
  // it checks maxMonthlyOrders before pulling more. Dormant until
  // PLAN_FEATURE_ENFORCED; dogfood org exempt; fail-open (see plan-ceilings.ts).
  // Webhook/cron ingestion paths are deliberately NOT gated (never block
  // mid-stream).
  if (await wouldExceedPlanCeiling(ctx.organizationId, 'maxMonthlyOrders')) {
    return NextResponse.json(planLimitResponseBody('maxMonthlyOrders'), { status: 403 });
  }

  // Body is optional (the settings "Sync now" button sends none); when present
  // it must validate.
  const raw = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY', detail: parsed.error.flatten() }, { status: 400 });
  }

  const outcome = await syncConnection(ctx.organizationId, provider, {
    manualSheetName: parsed.data.manualSheetName,
  });
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 502 });
});
