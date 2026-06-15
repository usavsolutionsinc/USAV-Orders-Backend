import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import { deleteEbayAccount } from '@/lib/ebay/credentials';

/**
 * GET /api/ebay/accounts
 * Get all eBay accounts with their status for the current tenant organization
 */
export const GET = withAuth(async (req, ctx) => {
  try {
    const result = await tenantQuery(
      ctx.organizationId,
      `SELECT 
        id, 
        account_name, 
        ebay_user_id, 
        token_expires_at, 
        last_sync_date, 
        is_active, 
        created_at,
        marketplace_id,
        platform
      FROM ebay_accounts 
      WHERE organization_id = $1
      ORDER BY account_name`,
      [ctx.organizationId]
    );

    return NextResponse.json({ 
      success: true,
      accounts: result.rows,
      count: result.rows.length,
    });
  } catch (error: any) {
    console.error('Error fetching eBay accounts:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}, { permission: 'integrations.ebay' });

/**
 * PUT /api/ebay/accounts
 * Update an eBay account (e.g., toggle active status) for the current tenant organization
 */
export const PUT = withAuth(async (req, ctx) => {
  try {
    const body = await req.json();
    const { id, is_active } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Account ID is required' },
        { status: 400 }
      );
    }

    const result = await tenantQuery(
      ctx.organizationId,
      'UPDATE ebay_accounts SET is_active = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3',
      [is_active, id, ctx.organizationId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { success: false, error: 'Account not found or access denied' },
        { status: 404 }
      );
    }

    return NextResponse.json({ 
      success: true,
      message: 'Account updated successfully'
    });
  } catch (error: any) {
    console.error('Error updating eBay account:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}, { permission: 'integrations.ebay' });

/**
 * DELETE /api/ebay/accounts?id=123
 * Disconnect an eBay account. eBay exposes no token-revocation API, so deleting
 * the row (which holds the encrypted access + refresh tokens) IS the revocation.
 * We intentionally do NOT touch organization_integrations: for eBay that row
 * holds the org's *app* credentials (appId/certId), not the seller token.
 *
 * step-up required (token destruction); admins are exempt per withAuth.
 */
export const DELETE = withAuth(async (req, ctx) => {
  const idParam = req.nextUrl.searchParams.get('id');
  const id = Number(idParam);
  if (!idParam || !Number.isInteger(id)) {
    return NextResponse.json({ ok: false, error: 'id must be an integer' }, { status: 400 });
  }

  const accountName = await deleteEbayAccount(ctx.organizationId, id);
  if (!accountName) {
    return NextResponse.json({ ok: false, error: 'Account not found or access denied' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, accountName });
}, {
  permission: 'integrations.ebay',
  stepUp: true,
  audit: {
    source: 'admin',
    action: 'integrations.ebay.disconnected',
    entityType: 'ebay_account',
    entityId: ({ req }) => new URL(req.url).searchParams.get('id'),
  },
});

