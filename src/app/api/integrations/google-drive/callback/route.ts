import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { decryptIntegrationPayload } from '@/lib/integrations/crypto';
import { upsertIntegrationCredentials, type GoogleDriveCredentials } from '@/lib/integrations/credentials';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import {
  driveAppConfig,
  exchangeDriveAuthCode,
  fetchDriveAccountEmail,
  createBackupRootFolder,
  upsertDriveProviderConfig,
  clearDriveTokenCache,
  DRIVE_SCOPES,
  DRIVE_BACKUP_FOLDER_NAME,
} from '@/lib/photos/drive/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STATE_TTL_MS = 15 * 60 * 1000;

/**
 * GET /api/integrations/google-drive/callback
 *
 * Google's server-side redirect after consent. No session cookie is present, so
 * tenant scope is recovered purely from the encrypted `state` (AES-GCM = tamper
 * proof, 15-min freshness window). Exchanges the code for a refresh token,
 * creates a backup folder in the user's Drive, and stores both in the org vault.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const back = (q: string) => NextResponse.redirect(`${origin}/settings/integrations?${q}`);

  try {
    const sp = req.nextUrl.searchParams;
    const code = sp.get('code');
    const state = sp.get('state');
    const oauthError = sp.get('error');

    if (oauthError) return back(`error=google_drive_${encodeURIComponent(oauthError)}`);
    if (!code || !state) return back('error=google_drive_missing_oauth_params');

    let parsed: { organizationId: string; createdBy?: number; issuedAt?: number };
    try {
      parsed = decryptIntegrationPayload(state);
    } catch {
      return back('error=google_drive_invalid_oauth_state');
    }

    const organizationId = parsed.organizationId;
    const createdBy = parsed.createdBy ?? null;
    if (!organizationId) return back('error=google_drive_incomplete_oauth_state');
    if (!parsed.issuedAt || Date.now() - parsed.issuedAt > STATE_TTL_MS) {
      return back('error=google_drive_oauth_state_expired');
    }

    const app = driveAppConfig();
    if (!app.clientId || !app.clientSecret) {
      return back('error=google_drive_server_configuration');
    }

    const tokens = await exchangeDriveAuthCode(code, app.redirectUri);
    if (!tokens.refreshToken) {
      // No refresh token → Google didn't re-prompt for offline consent. The
      // user must revoke prior access (or we must force prompt=consent, which we
      // do) and retry. Surface a clear message rather than storing a dead row.
      return back('error=google_drive_no_refresh_token');
    }

    const accountEmail = await fetchDriveAccountEmail(tokens.accessToken);
    const rootFolderId = await createBackupRootFolder(tokens.accessToken, DRIVE_BACKUP_FOLDER_NAME);

    const creds: GoogleDriveCredentials = {
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      accountEmail: accountEmail ?? undefined,
      rootFolderId,
      scope: tokens.scope ?? DRIVE_SCOPES.join(' '),
    };

    await upsertIntegrationCredentials({
      orgId: organizationId,
      provider: 'google_drive',
      payload: creds,
      displayLabel: accountEmail ? `Connected · ${accountEmail}` : 'Connected',
      createdBy,
    });

    // Non-secret, mutable config (root folder + lazily-grown subfolder cache).
    await upsertDriveProviderConfig(organizationId, {
      rootFolderId,
      folderName: DRIVE_BACKUP_FOLDER_NAME,
      accountEmail: accountEmail ?? undefined,
      subfolders: {},
    });

    clearDriveTokenCache(organizationId);

    await recordAudit(pool, null, req, {
      source: 'integrations/google-drive/callback',
      action: AUDIT_ACTION.INTEGRATION_CONNECT,
      entityType: AUDIT_ENTITY.INTEGRATION,
      entityId: 'google_drive',
      organizationIdOverride: organizationId,
      actorStaffIdOverride: createdBy,
      method: 'manual',
      after: { provider: 'google_drive', accountEmail, rootFolderId },
    });

    return back('success=google_drive_connected');
  } catch (err) {
    // Scope the log to the message — the raw error may carry token context.
    console.error('[google-drive/callback] error:', err instanceof Error ? err.message : String(err));
    return back('error=google_drive_callback_failed');
  }
}
