import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { encryptIntegrationPayload } from '@/lib/integrations/crypto';
import { driveAppConfig, isDriveBackupConfigured, DRIVE_SCOPES } from '@/lib/photos/drive/client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/integrations/google-drive/connect
 *
 * "Sign in with Google" entry point. Redirects the workspace owner to Google's
 * consent screen for the drive.file scope. Tenant identity travels in an
 * encrypted (tamper-proof) `state` so the callback — hit by Google's
 * server-side redirect without our cookies — can recover the org.
 *
 *   access_type=offline + prompt=consent  → guarantees a refresh_token.
 */
export const GET = withAuth(async (_req, ctx) => {
  if (!isDriveBackupConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Google Drive backup is not configured on the server. Set GOOGLE_DRIVE_CLIENT_ID, ' +
          'GOOGLE_DRIVE_CLIENT_SECRET and GOOGLE_DRIVE_REDIRECT_URI.',
      },
      { status: 500 },
    );
  }

  const { clientId, redirectUri } = driveAppConfig();

  const state = encryptIntegrationPayload({
    organizationId: ctx.organizationId,
    createdBy: ctx.staffId,
    issuedAt: Date.now(),
  });

  const consent = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  consent.searchParams.set('client_id', clientId);
  consent.searchParams.set('redirect_uri', redirectUri);
  consent.searchParams.set('response_type', 'code');
  consent.searchParams.set('scope', DRIVE_SCOPES.join(' '));
  consent.searchParams.set('access_type', 'offline');
  consent.searchParams.set('prompt', 'consent');
  consent.searchParams.set('include_granted_scopes', 'true');
  consent.searchParams.set('state', state);

  return NextResponse.redirect(consent.toString());
}, { permission: 'integrations.google_drive' });
