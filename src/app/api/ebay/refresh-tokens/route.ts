import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { refreshEbayAccessToken } from '@/lib/ebay/token-refresh';

/**
 * POST /api/ebay/refresh-tokens
 * Worker endpoint: refreshes all eBay accounts whose token expires within 30 minutes.
 * Protected by CRON_SECRET and intended to be invoked by the QStash wrapper.
 */
export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;

  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${secret}`) return true;

  const bodySecret = req.headers.get('x-cron-secret');
  if (bodySecret === secret) return true;

  return false;
}

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { rows: accounts } = await pool.query<{ account_name: string; refresh_token: string }>(
      `SELECT account_name, refresh_token
       FROM ebay_accounts
       WHERE (platform = 'EBAY' OR platform IS NULL)
         AND is_active = true
         AND token_expires_at <= NOW() + INTERVAL '30 minutes'
       ORDER BY token_expires_at ASC`
    );

    if (accounts.length === 0) {
      return NextResponse.json({
        success: true,
        refreshed: 0,
        message: 'No eBay tokens need refresh.',
      });
    }

    const clientId = process.env.EBAY_APP_ID;
    const clientSecret = process.env.EBAY_CERT_ID;
    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { success: false, error: 'EBAY_APP_ID or EBAY_CERT_ID not configured' },
        { status: 500 }
      );
    }

    let refreshed = 0;
    const errors: string[] = [];

    for (const { account_name, refresh_token } of accounts) {
      try {
        const { accessToken, expiresIn } = await refreshEbayAccessToken(
          clientId,
          clientSecret,
          refresh_token
        );
        const newExpiresAt = new Date(Date.now() + expiresIn * 1000);

        await pool.query(
          `UPDATE ebay_accounts
           SET access_token = $1, token_expires_at = $2, updated_at = NOW()
           WHERE account_name = $3`,
          [accessToken, newExpiresAt, account_name]
        );
        refreshed++;
        console.log(`[cron] Token refreshed: ${account_name}`);
      } catch (err: any) {
        errors.push(`${account_name}: ${err?.message || 'unknown'}`);
        console.error(`[cron] Token refresh failed for ${account_name}:`, err);
      }
    }

    return NextResponse.json({
      success: true,
      refreshed,
      total: accounts.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Refreshed ${refreshed}/${accounts.length} eBay tokens.`,
    });
  } catch (error: any) {
    console.error('[ebay/refresh-tokens]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(
    { success: false, error: 'Method not allowed. Use POST via the QStash worker route.' },
    { status: 405 }
  );
}
