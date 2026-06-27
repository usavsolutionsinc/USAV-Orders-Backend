/**
 * Google Drive photo-backup — auth + Drive REST plumbing (org-scoped).
 *
 * A tenant connects their OWN Google Drive via "Sign in with Google" (OAuth,
 * scope `drive.file`). We then back up photo originals into a folder THIS app
 * created in their Drive, so storage cost moves to the tenant.
 *
 * Token model (mirrors Amazon LWA):
 *   - The shared app's clientId/clientSecret come from env
 *     (GOOGLE_DRIVE_CLIENT_ID / _SECRET) — one Google Cloud OAuth client for the
 *     whole platform.
 *   - Each tenant's refresh token + root folder id live (encrypted) in the
 *     organization_integrations vault (provider='google_drive').
 *   - Short-lived access tokens are minted on demand and cached IN-PROCESS per
 *     org (never persisted) — same shape as zoho/core.ts.
 *
 * `drive.file` is least-privilege: this app can only ever see files it created,
 * so we never touch the rest of the user's Drive. That also keeps the OAuth app
 * in non-restricted-scope territory (no CASA security assessment).
 *
 * Zero new dependencies — plain fetch against the Drive v3 REST + upload
 * endpoints, like po-gmail/client.ts and amazon/token-refresh.ts.
 */

import pool from '@/lib/db';
import {
  getIntegrationCredentials,
  markIntegrationError,
  type GoogleDriveCredentials,
} from '@/lib/integrations/credentials';
import type { OrgId } from '@/lib/tenancy/constants';
import type { HealthResult, TokenEnvelope } from '@/lib/integrations/connectors/types';
import { resolvePublicAppUrl } from '@/lib/env-utils';

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Access-token refresh skew — refresh a little early so in-flight calls don't 401. */
const ACCESS_TOKEN_SKEW_MS = 60_000;

/** Scopes requested at consent. drive.file = app-created files only (least privilege). */
export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'email',
  'profile',
] as const;

/** Default name of the backup folder created in the tenant's Drive. */
export const DRIVE_BACKUP_FOLDER_NAME =
  process.env.PHOTOS_DRIVE_FOLDER_NAME?.trim() || 'USAV Photo Backup';

/**
 * Thrown when a tenant's Drive can't be reached because it's not connected or
 * its refresh token was revoked/expired. Callers map this to a 409 with a
 * reconnect prompt instead of an opaque 500.
 */
export class DriveNotConnectedError extends Error {
  constructor(message: string, public readonly needsReconnect: boolean) {
    super(message);
    this.name = 'DriveNotConnectedError';
  }
}

// ─── App config ─────────────────────────────────────────────────────────────

export interface DriveAppConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * The shared Google Cloud OAuth client. redirectUri prefers an explicit
 * GOOGLE_DRIVE_REDIRECT_URI (so it matches the value registered in the Cloud
 * Console exactly), falling back to the app's public origin.
 */
export function driveAppConfig(): DriveAppConfig {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() || '';
  const explicit = process.env.GOOGLE_DRIVE_REDIRECT_URI?.trim();
  const redirectUri = explicit || `${resolvePublicAppUrl()}/api/integrations/google-drive/callback`;
  return { clientId, clientSecret, redirectUri };
}

/** True when the platform OAuth client is configured (connect flow can run). */
export function isDriveBackupConfigured(): boolean {
  const c = driveAppConfig();
  return Boolean(c.clientId && c.clientSecret);
}

// ─── OAuth: authorization-code exchange (connect callback) ───────────────────

export interface DriveTokenExchange {
  refreshToken: string | null;
  accessToken: string;
  expiresAt: number;
  scope: string | null;
}

/** Exchange the consent `code` for tokens. Used by the OAuth callback route. */
export async function exchangeDriveAuthCode(
  code: string,
  redirectUri: string,
): Promise<DriveTokenExchange> {
  const { clientId, clientSecret } = driveAppConfig();
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET are not set');
  }
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  return {
    refreshToken: data.refresh_token ?? null,
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    scope: data.scope ?? null,
  };
}

/** Look up the connected account's email (display only). Best-effort. */
export async function fetchDriveAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    return data.email ?? null;
  } catch {
    return null;
  }
}

// ─── Access-token cache + refresh ────────────────────────────────────────────

interface CachedToken { token: string; expiresAt: number; }
const tokenCache = new Map<OrgId, CachedToken>();

async function loadDriveCreds(orgId: OrgId): Promise<GoogleDriveCredentials> {
  const creds = await getIntegrationCredentials<GoogleDriveCredentials>(orgId, 'google_drive');
  if (!creds || !creds.refreshToken) {
    throw new DriveNotConnectedError(
      'Google Drive is not connected. Connect it at Settings → Integrations.',
      false,
    );
  }
  return creds;
}

/**
 * A valid access token for this org's Drive. Cached in-process; refreshed via the
 * stored refresh token when expired. A 400/401 from Google means the refresh
 * token was revoked/expired — we flag the vault row (status='error') and throw a
 * reconnect-prompt error.
 */
export async function getDriveAccessToken(orgId: OrgId): Promise<string> {
  const cached = tokenCache.get(orgId);
  if (cached && cached.expiresAt > Date.now() + ACCESS_TOKEN_SKEW_MS) return cached.token;

  const creds = await loadDriveCreds(orgId);
  const clientId = creds.clientId || process.env.GOOGLE_DRIVE_CLIENT_ID?.trim() || '';
  const clientSecret = creds.clientSecret || process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() || '';

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    if (res.status === 400 || res.status === 401) {
      await markIntegrationError(orgId, 'google_drive', `Token refresh rejected (${res.status}): ${text}`);
      tokenCache.delete(orgId);
      throw new DriveNotConnectedError(
        'Google Drive needs to be reconnected (refresh token revoked or expired).',
        true,
      );
    }
    throw new Error(`Google Drive token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  const token = data.access_token;
  const expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  tokenCache.set(orgId, { token, expiresAt });
  return token;
}

/** Connector hook — rotate + return the token envelope. */
export async function refreshDriveToken(orgId: OrgId): Promise<TokenEnvelope | null> {
  try {
    const token = await getDriveAccessToken(orgId);
    return { accessToken: token, expiresAt: tokenCache.get(orgId)?.expiresAt };
  } catch (err) {
    if (err instanceof DriveNotConnectedError) return null;
    throw err;
  }
}

/** Connector/health hook — validate the stored credential by hitting Drive. */
export async function validateDriveConnection(orgId: OrgId): Promise<HealthResult> {
  try {
    const quota = await getDriveQuota(orgId);
    return { ok: true, detail: quota ?? undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Drive validation failed' };
  }
}

// ─── Folder management ───────────────────────────────────────────────────────

async function driveCreateFolder(
  accessToken: string,
  name: string,
  parentId?: string,
): Promise<string> {
  const res = await fetch(`${DRIVE_API}/files?fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`Drive folder create failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

/**
 * Create the root backup folder in the user's Drive. Called once at connect
 * time with the freshly-minted access token (before the vault row exists).
 */
export async function createBackupRootFolder(accessToken: string, name = DRIVE_BACKUP_FOLDER_NAME): Promise<string> {
  return driveCreateFolder(accessToken, name);
}

// ── Subfolder cache (non-secret, mutable) → photo_storage_providers.config ──

interface DriveProviderConfig {
  rootFolderId?: string;
  folderName?: string;
  accountEmail?: string;
  /** "yyyy/MM" → Drive folder id, so we don't re-create + re-search per upload. */
  subfolders?: Record<string, string>;
}

async function readDriveProviderConfig(orgId: OrgId): Promise<DriveProviderConfig> {
  const res = await pool.query<{ config: DriveProviderConfig | null }>(
    `SELECT config FROM photo_storage_providers
      WHERE organization_id = $1 AND provider = 'google_drive' LIMIT 1`,
    [orgId],
  );
  return res.rows[0]?.config ?? {};
}

/** Merge-patch the google_drive provider config row (creates it if missing). */
export async function upsertDriveProviderConfig(orgId: OrgId, patch: DriveProviderConfig): Promise<void> {
  await pool.query(
    `INSERT INTO photo_storage_providers (organization_id, provider, is_default, config)
     VALUES ($1, 'google_drive', FALSE, $2::jsonb)
     ON CONFLICT (organization_id, provider)
     DO UPDATE SET config = photo_storage_providers.config || EXCLUDED.config,
                   updated_at = NOW()`,
    [orgId, JSON.stringify(patch)],
  );
}

async function cacheSubfolder(orgId: OrgId, key: string, id: string): Promise<void> {
  // Merge a single subfolder into the JSONB map without clobbering siblings.
  await pool.query(
    `UPDATE photo_storage_providers
        SET config = jsonb_set(
              COALESCE(config, '{}'::jsonb),
              ARRAY['subfolders', $3],
              to_jsonb($4::text),
              true),
            updated_at = NOW()
      WHERE organization_id = $1 AND provider = $2`,
    [orgId, 'google_drive', key, id],
  );
}

/**
 * Resolve (creating + caching as needed) the Drive folder id for a path of
 * segments under the root, e.g. ['2026','06'] → .../USAV Photo Backup/2026/06.
 * Cache key is the joined path so each level is created at most once per org.
 */
export async function ensureSubfolderPath(
  orgId: OrgId,
  accessToken: string,
  rootFolderId: string,
  segments: string[],
): Promise<string> {
  const cfg = await readDriveProviderConfig(orgId);
  const cache = cfg.subfolders ?? {};
  let parentId = rootFolderId;
  let pathKey = '';
  for (const seg of segments) {
    pathKey = pathKey ? `${pathKey}/${seg}` : seg;
    const hit = cache[pathKey];
    if (hit) {
      parentId = hit;
      continue;
    }
    const id = await driveCreateFolder(accessToken, seg, parentId);
    cache[pathKey] = id;
    await cacheSubfolder(orgId, pathKey, id);
    parentId = id;
  }
  return parentId;
}

// ─── Upload / read / delete ──────────────────────────────────────────────────

export interface DriveUploadResult {
  fileId: string;
  webViewLink: string | null;
  size: number | null;
  md5: string | null;
}

/**
 * Upload one image into `folderId` via a multipart/related request (metadata +
 * bytes in one round trip). Returns the new Drive file id + view link.
 */
export async function uploadPhotoToDrive(
  orgId: OrgId,
  opts: { folderId: string; name: string; bytes: Buffer | Uint8Array; contentType: string },
): Promise<DriveUploadResult> {
  const accessToken = await getDriveAccessToken(orgId);
  const boundary = `usav_drive_${Date.now().toString(16)}`;
  const meta = JSON.stringify({ name: opts.name, parents: [opts.folderId] });
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: ${opts.contentType}\r\n\r\n`,
    'utf8',
  );
  const post = Buffer.from(`\r\n--${boundary}--`, 'utf8');
  const body = Buffer.concat([pre, Buffer.from(opts.bytes), post]);

  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id,size,md5Checksum,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: new Uint8Array(body),
  });
  if (!res.ok) {
    throw new Error(`Drive upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    id: string;
    size?: string;
    md5Checksum?: string;
    webViewLink?: string;
  };
  return {
    fileId: data.id,
    webViewLink: data.webViewLink ?? null,
    size: data.size ? Number(data.size) : null,
    md5: data.md5Checksum ?? null,
  };
}

/** Download a Drive file's bytes by id (org-scoped token). Null if gone. */
export async function getDriveFileMedia(
  orgId: OrgId,
  fileId: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const accessToken = await getDriveAccessToken(orgId);
  const res = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Drive download failed (${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    bytes: new Uint8Array(buf),
    contentType: res.headers.get('content-type') || 'image/jpeg',
  };
}

/** Delete a Drive file by id. Tolerates already-deleted (404). */
export async function deleteDriveFile(orgId: OrgId, fileId: string): Promise<void> {
  const accessToken = await getDriveAccessToken(orgId);
  const res = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Drive delete failed (${res.status})`);
  }
}

/** The connected account's storage quota (bytes), for the settings card. */
export async function getDriveQuota(
  orgId: OrgId,
): Promise<{ limit: number | null; usage: number | null } | null> {
  const accessToken = await getDriveAccessToken(orgId);
  const res = await fetch(`${DRIVE_API}/about?fields=storageQuota`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive about failed (${res.status})`);
  const data = (await res.json()) as { storageQuota?: { limit?: string; usage?: string } };
  const q = data.storageQuota;
  return {
    limit: q?.limit ? Number(q.limit) : null,
    usage: q?.usage ? Number(q.usage) : null,
  };
}

/** Clear the cached access token for an org (call on disconnect/reconnect). */
export function clearDriveTokenCache(orgId: OrgId): void {
  tokenCache.delete(orgId);
}
