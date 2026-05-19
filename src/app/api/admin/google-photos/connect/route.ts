import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
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

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const clientId = process.env.GOOGLE_PHOTOS_CLIENT_ID;
    if (!clientId) {
      throw ApiError.badRequest('GOOGLE_PHOTOS_CLIENT_ID is not set in environment');
    }

    const state = randomBytes(16).toString('hex');
    const redirectUri = getRedirectUri(req);

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', GOOGLE_PHOTOS_SCOPE);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);

    const res = NextResponse.redirect(authUrl.toString());
    res.cookies.set('gp_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 600,
      path: '/',
    });
    return res;
  } catch (error) {
    return errorResponse(error, 'GET /api/admin/google-photos/connect');
  }
}, { permission: 'admin.view' });
