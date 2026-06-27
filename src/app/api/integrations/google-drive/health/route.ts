import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getIntegrationCredentials, type GoogleDriveCredentials } from '@/lib/integrations/credentials';
import { validateDriveConnection, isDriveBackupConfigured } from '@/lib/photos/drive/client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/integrations/google-drive/health
 *
 * Live-checks the stored Drive credential by minting a token and reading the
 * account's storage quota. Drives the "Check" button on the integration card.
 */
export const GET = withAuth(async (_req, ctx) => {
  if (!isDriveBackupConfigured()) {
    return NextResponse.json({ ok: false, error: 'Drive backup not configured on the server.' }, { status: 200 });
  }
  const creds = await getIntegrationCredentials<GoogleDriveCredentials>(ctx.organizationId, 'google_drive');
  if (!creds?.refreshToken) {
    return NextResponse.json({ ok: false, error: 'Google Drive is not connected.' }, { status: 200 });
  }
  const result = await validateDriveConnection(ctx.organizationId);
  return NextResponse.json(result, { status: 200 });
}, { permission: 'integrations.google_drive' });
