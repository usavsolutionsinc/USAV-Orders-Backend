import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import { deleteIntegrationCredentials } from '@/lib/integrations/credentials';
import { amazonScopeForSeller } from '@/lib/amazon/accounts';

export const dynamic = 'force-dynamic';

/**
 * GET /api/amazon/accounts
 * List the org's connected Amazon accounts (non-secret metadata + sync state).
 */
export const GET = withAuth(async (req, ctx) => {
  const { rows } = await tenantQuery(
    ctx.organizationId,
    `SELECT id, account_name, seller_id, region, marketplace_ids, status, is_active,
            last_sync_at, last_updated_watermark, last_error, created_at
       FROM amazon_accounts
      WHERE organization_id = $1
      ORDER BY account_name`,
    [ctx.organizationId],
  );
  return NextResponse.json({ ok: true, accounts: rows, count: rows.length });
}, { permission: 'integrations.amazon' });

/**
 * DELETE /api/amazon/accounts?id=123
 * Disconnect an account: drop the metadata row and its vault credentials.
 */
export const DELETE = withAuth(async (req, ctx) => {
  const idParam = req.nextUrl.searchParams.get('id');
  const id = Number(idParam);
  if (!idParam || !Number.isInteger(id)) {
    return NextResponse.json({ ok: false, error: 'id must be an integer' }, { status: 400 });
  }

  const { rows } = await tenantQuery(
    ctx.organizationId,
    `SELECT seller_id FROM amazon_accounts WHERE id = $1 AND organization_id = $2`,
    [id, ctx.organizationId],
  );
  if (!rows[0]) return NextResponse.json({ ok: false, error: 'Account not found' }, { status: 404 });

  await tenantQuery(
    ctx.organizationId,
    `DELETE FROM amazon_accounts WHERE id = $1 AND organization_id = $2`,
    [id, ctx.organizationId],
  );
  await deleteIntegrationCredentials(ctx.organizationId, 'amazon', amazonScopeForSeller(rows[0].seller_id));

  return NextResponse.json({ ok: true });
}, {
  permission: 'integrations.amazon',
  audit: {
    source: 'admin',
    action: 'integrations.amazon.disconnected',
    entityType: 'amazon_account',
    entityId: ({ req }) => new URL(req.url).searchParams.get('id'),
  },
});
