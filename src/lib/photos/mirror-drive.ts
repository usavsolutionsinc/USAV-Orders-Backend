/**
 * Google Drive photo backup — copy a GCS-primary photo into the tenant's own
 * Google Drive (a second photo_storage row, provider='google_drive').
 *
 * Structurally identical to mirror-nas.ts: select candidates → enqueue
 * export_drive jobs → claim → upload → record a non-primary photo_storage row.
 * Selection only picks orgs that have an ACTIVE google_drive vault connection,
 * so the cron is a no-op for tenants who never connected Drive.
 */

import pool from '@/lib/db';
import { readPhotoBytesById } from './read-bytes';
import {
  claimPendingJobs,
  completePhotoJob,
  enqueuePhotoJob,
  failPhotoJob,
} from './jobs';
import { getPrimaryPhotoStorage } from './storage/resolve-primary';
import {
  ensureSubfolderPath,
  getDriveAccessToken,
  uploadPhotoToDrive,
  DriveNotConnectedError,
} from './drive/client';
import { getIntegrationCredentials, type GoogleDriveCredentials } from '@/lib/integrations/credentials';

const MIRROR_AFTER_DAYS = Number(process.env.PHOTOS_DRIVE_MIRROR_AFTER_DAYS || 0);

/** Copy a GCS-primary photo into the org's Google Drive (second storage row). */
export async function mirrorPhotoToDrive(input: {
  photoId: number;
  organizationId: string;
}): Promise<{ driveFileId: string }> {
  const primary = await getPrimaryPhotoStorage(input.photoId, input.organizationId);
  if (!primary || primary.provider !== 'gcs') {
    throw new Error('Photo has no GCS primary storage');
  }

  const existing = await pool.query(
    `SELECT 1 FROM photo_storage
      WHERE photo_id = $1 AND organization_id = $2 AND provider = 'google_drive'`,
    [input.photoId, input.organizationId],
  );
  if ((existing.rowCount ?? 0) > 0) {
    throw new Error('Drive backup already exists');
  }

  const creds = await getIntegrationCredentials<GoogleDriveCredentials>(
    input.organizationId,
    'google_drive',
  );
  if (!creds?.rootFolderId) {
    throw new DriveNotConnectedError('Google Drive is not connected for this org.', false);
  }

  const photoMeta = await pool.query<{ po_ref: string | null; created_at: string }>(
    `SELECT p.po_ref, p.created_at::text
       FROM photos p
      WHERE p.id = $1 AND p.organization_id = $2
      LIMIT 1`,
    [input.photoId, input.organizationId],
  );
  const meta = photoMeta.rows[0];
  if (!meta) throw new Error('Photo not found');

  const bytes = await readPhotoBytesById(input.photoId, input.organizationId);
  if (!bytes) throw new Error('Photo bytes unreadable');

  const created = new Date(meta.created_at);
  const yyyy = String(created.getUTCFullYear());
  const mm = String(created.getUTCMonth() + 1).padStart(2, '0');
  const po = (meta.po_ref || 'unknown').replace(/[^\w.-]+/g, '_');
  const fileName = `PO-${po}_${input.photoId}.jpg`;

  const accessToken = await getDriveAccessToken(input.organizationId);
  const folderId = await ensureSubfolderPath(
    input.organizationId,
    accessToken,
    creds.rootFolderId,
    [yyyy, mm],
  );

  const upload = await uploadPhotoToDrive(input.organizationId, {
    folderId,
    name: fileName,
    bytes: Buffer.from(bytes.bytes),
    contentType: bytes.contentType,
  });

  await pool.query(
    `INSERT INTO photo_storage
       (photo_id, organization_id, provider, bucket, object_key, legacy_url,
        content_type, file_size_bytes, is_primary, provider_meta)
     VALUES ($1, $2, 'google_drive', NULL, $3, $4, $5, $6, FALSE, $7)`,
    [
      input.photoId,
      input.organizationId,
      upload.fileId,
      upload.webViewLink,
      bytes.contentType,
      upload.size ?? bytes.bytes.length,
      JSON.stringify({
        source: 'gcs_mirror',
        gcs_key: primary.objectKey,
        driveFileId: upload.fileId,
        webViewLink: upload.webViewLink,
        md5: upload.md5,
        folderPath: `${yyyy}/${mm}`,
      }),
    ],
  );

  return { driveFileId: upload.fileId };
}

export async function selectPhotosForDriveMirror(
  limit: number,
  opts?: { organizationId?: string; skipAgeGate?: boolean },
): Promise<Array<{ photoId: number; organizationId: string }>> {
  const params: unknown[] = [limit];
  const orgClause = opts?.organizationId
    ? (params.push(opts.organizationId), `AND p.organization_id = $${params.length}`)
    : '';
  const ageClause = opts?.skipAgeGate || MIRROR_AFTER_DAYS <= 0
    ? ''
    : (params.push(MIRROR_AFTER_DAYS), `AND p.created_at < NOW() - ($${params.length}::int * INTERVAL '1 day')`);

  const res = await pool.query<{ photo_id: string; organization_id: string }>(
    `SELECT ps.photo_id, ps.organization_id
       FROM photo_storage ps
       JOIN photos p ON p.id = ps.photo_id
       -- Only orgs that actually connected Google Drive.
       JOIN organization_integrations oi
         ON oi.organization_id = ps.organization_id
        AND oi.provider = 'google_drive'
        AND oi.status = 'active'
      WHERE ps.provider = 'gcs'
        AND ps.is_primary = TRUE
        ${ageClause}
        ${orgClause}
        AND NOT EXISTS (
          SELECT 1 FROM photo_storage d
           WHERE d.photo_id = ps.photo_id AND d.provider = 'google_drive'
        )
        AND NOT EXISTS (
          SELECT 1 FROM photo_jobs j
           WHERE j.photo_id = ps.photo_id
             AND j.job_type = 'export_drive'
             AND j.status IN ('pending', 'running')
        )
      ORDER BY p.created_at ASC
      LIMIT $1`,
    params,
  );
  return res.rows.map((r) => ({
    photoId: Number(r.photo_id),
    organizationId: r.organization_id,
  }));
}

export async function countPendingDriveMirror(organizationId: string): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM photo_storage ps
       JOIN photos p ON p.id = ps.photo_id
      WHERE ps.provider = 'gcs'
        AND ps.is_primary = TRUE
        AND p.organization_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM photo_storage d
           WHERE d.photo_id = ps.photo_id AND d.provider = 'google_drive'
        )`,
    [organizationId],
  );
  return Number(res.rows[0]?.count ?? 0);
}

export async function runDriveMirrorJob(job: {
  photoId: number;
  organizationId: string;
}): Promise<void> {
  await mirrorPhotoToDrive(job);
}

/** Enqueue + run one Drive backup batch for an org (manual backup from the UI). */
export async function runDriveBackupBatch(input: {
  organizationId: string;
  limit?: number;
  skipAgeGate?: boolean;
}): Promise<{ enqueued: number; completed: number; failed: number; remaining: number }> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const candidates = await selectPhotosForDriveMirror(limit, {
    organizationId: input.organizationId,
    skipAgeGate: input.skipAgeGate ?? true,
  });

  for (const row of candidates) {
    await enqueuePhotoJob({
      photoId: row.photoId,
      organizationId: row.organizationId,
      jobType: 'export_drive',
    });
  }

  const jobs = await claimPendingJobs('export_drive', limit);
  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      await runDriveMirrorJob(job);
      await completePhotoJob(job.id);
      if (job.organizationId === input.organizationId) completed++;
    } catch (err) {
      if (job.organizationId === input.organizationId) failed++;
      await failPhotoJob(
        job.id,
        err instanceof Error ? err.message : 'drive backup failed',
        job.attempts,
      );
    }
  }

  const remaining = await countPendingDriveMirror(input.organizationId);
  return { enqueued: candidates.length, completed, failed, remaining };
}
