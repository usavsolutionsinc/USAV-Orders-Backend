/**
 * POST /api/integrations/[provider]/sync — "Sync now" for the caller's org.
 *
 * Runs the connector's wired sync() (connection-driven ingestion). Replaces the
 * ad-hoc transfer-orders / backfill buttons with a per-connection action.
 * 400 when the provider has no sync capability; 403 without the provider's
 * manage permission.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getConnector } from '@/lib/integrations/connectors/registry';
import { syncConnection } from '@/lib/integrations/connectors/orchestrator';
import type { IntegrationProvider } from '@/lib/integrations/credentials';
import type { PermissionString } from '@/lib/auth/permissions';

function managePermission(provider: string): PermissionString {
  if (provider === 'ebay') return 'integrations.ebay';
  if (provider === 'amazon') return 'integrations.amazon';
  if (provider === 'zoho') return 'integrations.zoho';
  return 'admin.manage_features';
}

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

  const outcome = await syncConnection(ctx.organizationId, provider);
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 502 });
});
