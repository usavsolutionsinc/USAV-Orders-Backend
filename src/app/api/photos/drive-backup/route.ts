import { NextRequest, NextResponse } from 'next/server';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import { getIntegrationCredentials, type GoogleDriveCredentials } from '@/lib/integrations/credentials';
import { countPendingDriveMirror, runDriveBackupBatch } from '@/lib/photos/mirror-drive';
import { getDriveQuota, isDriveBackupConfigured, DriveNotConnectedError } from '@/lib/photos/drive/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET  /api/photos/drive-backup — Drive backup status for the photo library UI.
 * POST /api/photos/drive-backup — enqueue + run one backup batch (GCS → the
 *      tenant's own Google Drive).
 */
export const GET = withAuth(async (_req, ctx) => {
  try {
    const creds = await getIntegrationCredentials<GoogleDriveCredentials>(ctx.organizationId, 'google_drive');
    const connected = Boolean(creds?.refreshToken);
    const remaining = await countPendingDriveMirror(ctx.organizationId);
    let quota: { limit: number | null; usage: number | null } | null = null;
    if (connected) {
      try {
        quota = await getDriveQuota(ctx.organizationId);
      } catch {
        /* quota is best-effort; a refresh failure shows up via /health */
      }
    }
    return NextResponse.json({
      appConfigured: isDriveBackupConfigured(),
      connected,
      accountEmail: creds?.accountEmail ?? null,
      pendingMirror: remaining,
      quota,
    });
  } catch (error) {
    return errorResponse(error, 'GET /api/photos/drive-backup');
  }
}, { permission: 'photos.view' });

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const creds = await getIntegrationCredentials<GoogleDriveCredentials>(ctx.organizationId, 'google_drive');
    if (!creds?.refreshToken || !creds.rootFolderId) {
      throw ApiError.badRequest('Google Drive is not connected. Connect it at Settings → Integrations.');
    }

    const body = (await req.json().catch(() => ({}))) as { limit?: number };
    const result = await runDriveBackupBatch({
      organizationId: ctx.organizationId,
      limit: body.limit,
      skipAgeGate: true,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof DriveNotConnectedError) {
      return NextResponse.json({ error: 'DRIVE_RECONNECT_REQUIRED', message: error.message }, { status: 409 });
    }
    return errorResponse(error, 'POST /api/photos/drive-backup');
  }
}, { permission: 'integrations.google_drive' });
