import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { GOOGLE_PHOTOS_SCOPE } from '@/lib/google-photos/client';
import { ApiError, errorResponse } from '@/lib/api';

export const dynamic = 'force-dynamic';

function getRedirectUri(req: NextRequest): string {
  const explicit = process.env.GOOGLE_PHOTOS_REDIRECT_URI;
  if (explicit) return explicit;
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}/api/admin/google-photos/oauth-callback`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

interface UserInfo {
  email?: string;
}

export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const errParam = url.searchParams.get('error');

    if (errParam) {
      return NextResponse.redirect(`${url.origin}/admin?section=photo_backup&gp_error=${encodeURIComponent(errParam)}`);
    }
    if (!code || !state) {
      throw ApiError.badRequest('Missing code or state');
    }

    const stateCookie = req.cookies.get('gp_oauth_state')?.value;
    if (!stateCookie || stateCookie !== state) {
      throw ApiError.badRequest('OAuth state mismatch');
    }

    const clientId = process.env.GOOGLE_PHOTOS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_PHOTOS_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw ApiError.badRequest('GOOGLE_PHOTOS_CLIENT_ID / GOOGLE_PHOTOS_CLIENT_SECRET missing');
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: getRedirectUri(req),
      }),
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new Error(`Token exchange failed (${tokenRes.status}): ${text}`);
    }
    const tokens = (await tokenRes.json()) as TokenResponse;
    if (!tokens.refresh_token) {
      throw new Error('Google did not return a refresh token. Revoke the app in your Google account and retry.');
    }

    let accountEmail: string | null = null;
    try {
      const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (infoRes.ok) {
        const info = (await infoRes.json()) as UserInfo;
        accountEmail = info.email ?? null;
      }
    } catch {
      // best-effort; we don't need the email
    }

    const expiresAt = new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString();

    await pool.query(
      `INSERT INTO google_oauth_tokens
         (provider, account_email, scope, refresh_token, access_token, expires_at, connected_by_staff_id)
       VALUES ('google_photos', $1, $2, $3, $4, $5, $6)
       ON CONFLICT (provider) DO UPDATE
         SET account_email = EXCLUDED.account_email,
             scope = EXCLUDED.scope,
             refresh_token = EXCLUDED.refresh_token,
             access_token = EXCLUDED.access_token,
             expires_at = EXCLUDED.expires_at,
             connected_by_staff_id = EXCLUDED.connected_by_staff_id`,
      [accountEmail, GOOGLE_PHOTOS_SCOPE, tokens.refresh_token, tokens.access_token, expiresAt, ctx.staffId],
    );

    await pool.query(
      `UPDATE google_photos_settings
         SET needs_reconnect = FALSE, needs_reconnect_reason = NULL
       WHERE id = 1`,
    );

    const res = NextResponse.redirect(`${url.origin}/admin?section=photo_backup&gp_connected=1`);
    res.cookies.delete('gp_oauth_state');
    return res;
  } catch (error) {
    return errorResponse(error, 'GET /api/admin/google-photos/oauth-callback');
  }
}, { permission: 'admin.view' });
