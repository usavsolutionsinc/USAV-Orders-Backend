/**
 * GET /api/admin/integrations/list
 *
 * Lists the caller tenant's integration rows for the admin UI. Never
 * returns the encrypted payload — only the metadata that's safe to show
 * (provider, status, display label, last error, last used).
 *
 * Gated by admin.view because seeing "we have Zoho connected" still leaks
 * business intent that random staff don't need to know.
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';

interface Row {
  provider: string;
  status: string;
  display_label: string | null;
  last_used_at: Date | null;
  last_error: string | null;
  scope: string | null;
  updated_at: Date;
}

export const GET = withAuth(async (_req, ctx) => {
  const r = await tenantQuery<Row>(
    ctx.organizationId,
    `SELECT provider, status, display_label, last_used_at, last_error, scope, updated_at
       FROM organization_integrations
      WHERE organization_id = $1
      ORDER BY provider ASC, scope NULLS FIRST`,
    [ctx.organizationId],
  );
  return NextResponse.json({ integrations: r.rows });
}, { permission: 'admin.view' });
