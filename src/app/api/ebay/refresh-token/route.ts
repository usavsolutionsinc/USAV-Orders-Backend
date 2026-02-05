import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { refreshEbayAccessToken } from '@/lib/ebay/token-refresh';

/**
 * POST /api/ebay/refresh-token
 * Manually refresh access token for a specific account
 */
export async function POST(req: Request) {
  try {
    const { accountName } = await req.json();
    
    if (!accountName) {
      return NextResponse.json(
        { success: false, error: 'Account name is required' },
        { status: 400 }
      );
    }

    console.log(`Manual token refresh requested for: ${accountName}`);

    // Get current refresh token from database
    const result = await pool.query(
      'SELECT refresh_token FROM ebay_accounts WHERE account_name = $1',
      [accountName]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: `Account ${accountName} not found` },
        { status: 404 }
      );
    }

    const { refresh_token } = result.rows[0];

    // Refresh the token using direct HTTP call
    const { accessToken, expiresIn } = await refreshEbayAccessToken(
      process.env.EBAY_APP_ID!,
      process.env.EBAY_CERT_ID!,
      refresh_token
    );

    const newExpiresAt = new Date(Date.now() + expiresIn * 1000);

    // Update database
    await pool.query(
      `UPDATE ebay_accounts 
       SET access_token = $1, token_expires_at = $2, updated_at = NOW() 
       WHERE account_name = $3`,
      [accessToken, newExpiresAt, accountName]
    );

    console.log(`✅ Token refreshed for ${accountName}`);

    return NextResponse.json({
      success: true,
      message: `Token refreshed successfully for ${accountName}`,
      expiresAt: newExpiresAt.toISOString(),
      expiresIn,
    });
  } catch (error: any) {
    console.error('Error refreshing token:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
