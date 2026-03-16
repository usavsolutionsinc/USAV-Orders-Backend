import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/zoho';

export const dynamic = 'force-dynamic';

/**
 * GET /api/zoho/refresh-token
 *
 * Starts a fresh Zoho OAuth consent flow. Zoho only issues a refresh_token
 * on an authorization_code grant with offline access, not on a refresh grant.
 * The callback route persists the returned refresh_token to the database.
 */
export async function GET(request: NextRequest) {
  const authorizeUrl = new URL('/api/zoho/oauth/authorize', request.url);
  return NextResponse.redirect(authorizeUrl);
}

/**
 * POST /api/zoho/refresh-token
 *
 * Refreshes the short-lived access token using the stored refresh token.
 * This endpoint does not mint a new refresh_token; use GET on this route
 * to start a new consent flow when you need one stored in the DB.
 */
export async function POST(request: NextRequest) {
  try {
    const token = await getAccessToken();
    return NextResponse.json({
      success: true,
      message: 'Zoho access token refreshed successfully.',
      note:
        'Zoho does not return a new refresh_token on refresh_token grants. Use GET /api/zoho/refresh-token to start a new consent flow if you need one stored.',
      authorize_path: new URL('/api/zoho/refresh-token', request.url).pathname,
      access_token_preview: token ? `${token.slice(0, 6)}...` : null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to refresh Zoho token';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
