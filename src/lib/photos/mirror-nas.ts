import pool from '@/lib/db';
import { readPhotoBytesById } from './read-bytes';
import {
  claimPendingJobs,
  completePhotoJob,
  enqueuePhotoJob,
  failPhotoJob,
} from './jobs';
import { getPrimaryPhotoStorage } from './storage/resolve-primary';

const MIRROR_AFTER_DAYS = Number(process.env.PHOTOS_NAS_MIRROR_AFTER_DAYS || 90);

export function isNasMirrorConfigured(): boolean {
  return Boolean(process.env.NAS_AGENT_URL?.trim() && process.env.NAS_AGENT_TOKEN?.trim());
}

function nasAgentConfigured(): boolean {
  return isNasMirrorConfigured();
}

async function putToNasAgent(opts: {
  relativePath: string;
  bytes: Buffer;
  contentType: string;
}): Promise<string> {
  const base = (process.env.NAS_AGENT_URL || '').replace(/\/+$/, '');
  const token = process.env.NAS_AGENT_TOKEN || '';
  const url = `${base}/file/receiving/${opts.relativePath.split('/').map(encodeURIComponent).join('/')}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'content-type': opts.contentType,
      'x-agent-token': token,
    },
    body: new Uint8Array(opts.bytes),
  });
  if (!res.ok) throw new Error(`NAS agent PUT failed (${res.status})`);
  return `/api/nas/${opts.relativePath}`;
}

/** Copy a GCS-primary photo to NAS cold storage (second photo_storage row). */
export async function mirrorPhotoToNas(input: {
  photoId: number;
  organizationId: string;
}): Promise<{ nasPath: string }> {
  const primary = await getPrimaryPhotoStorage(input.photoId, input.organizationId);
  if (!primary || primary.provider !== 'gcs') {
    throw new Error('Photo has no GCS primary storage');
  }

  const existing = await pool.query(
    `SELECT 1 FROM photo_storage
      WHERE photo_id = $1 AND organization_id = $2 AND provider = 'nas'`,
    [input.photoId, input.organizationId],
  );
  if ((existing.rowCount ?? 0) > 0) {
    throw new Error('NAS mirror already exists');
  }

  const photoMeta = await pool.query<{
    entity_type: string | null;
    po_ref: string | null;
    created_at: string;
  }>(
    `SELECT l.entity_type, p.po_ref, p.created_at::text
       FROM photos p
       LEFT JOIN photo_entity_links l
         ON l.photo_id = p.id AND l.organization_id = p.organization_id AND l.link_role = 'primary'
      WHERE p.id = $1 AND p.organization_id = $2
      ORDER BY l.id ASC
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
  const relPath = `ReceivingPhotos/${yyyy}/PO-${po}/${input.photoId}.jpg`;

  let legacyUrl: string;
  if (nasAgentConfigured()) {
    legacyUrl = await putToNasAgent({
      relativePath: relPath,
      bytes: Buffer.from(bytes.bytes),
      contentType: bytes.contentType,
    });
  } else if (process.env.NAS_DEV_ROOT) {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const target = join(process.env.NAS_DEV_ROOT, relPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes.bytes);
    legacyUrl = `/api/nas-dev/${relPath}`;
  } else {
    throw new Error('NAS agent or NAS_DEV_ROOT not configured');
  }

  await pool.query(
    `INSERT INTO photo_storage
       (photo_id, organization_id, provider, bucket, object_key, legacy_url,
        content_type, file_size_bytes, is_primary, provider_meta)
     VALUES ($1, $2, 'nas', NULL, $3, $4, $5, $6, FALSE, $7)`,
    [
      input.photoId,
      input.organizationId,
      relPath,
      legacyUrl,
      bytes.contentType,
      bytes.bytes.length,
      JSON.stringify({ source: 'gcs_mirror', gcs_key: primary.objectKey }),
    ],
  );

  return { nasPath: relPath };
}

export async function selectPhotosForNasMirror(
  limit: number,
  opts?: { organizationId?: string; skipAgeGate?: boolean },
): Promise<Array<{ photoId: number; organizationId: string }>> {
  const params: unknown[] = [limit];
  const orgClause = opts?.organizationId
    ? (params.push(opts.organizationId), `AND p.organization_id = $${params.length}`)
    : '';
  const ageClause = opts?.skipAgeGate
    ? ''
    : (params.push(MIRROR_AFTER_DAYS), `AND p.created_at < NOW() - ($${params.length}::int * INTERVAL '1 day')`);

  const res = await pool.query<{ photo_id: string; organization_id: string }>(
    `SELECT ps.photo_id, ps.organization_id
       FROM photo_storage ps
       JOIN photos p ON p.id = ps.photo_id
       JOIN organizations o ON o.id = ps.organization_id
      WHERE ps.provider = 'gcs'
        AND ps.is_primary = TRUE
        -- Settings Registry: skip orgs that turned NAS backup off (unset = mirror).
        AND COALESCE(o.settings->>'receiving.nasBackup', 'mirror') <> 'off'
        ${ageClause}
        ${orgClause}
        AND NOT EXISTS (
          SELECT 1 FROM photo_storage nas
           WHERE nas.photo_id = ps.photo_id AND nas.provider = 'nas'
        )
        AND NOT EXISTS (
          SELECT 1 FROM photo_jobs j
           WHERE j.photo_id = ps.photo_id
             AND j.job_type = 'nas_mirror'
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

export async function countPendingNasMirror(organizationId: string): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM photo_storage ps
       JOIN photos p ON p.id = ps.photo_id
      WHERE ps.provider = 'gcs'
        AND ps.is_primary = TRUE
        AND p.organization_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM photo_storage nas
           WHERE nas.photo_id = ps.photo_id AND nas.provider = 'nas'
        )`,
    [organizationId],
  );
  return Number(res.rows[0]?.count ?? 0);
}

export async function runNasMirrorJob(job: {
  photoId: number;
  organizationId: string;
}): Promise<void> {
  await mirrorPhotoToNas(job);
}

/** Enqueue + run one NAS mirror batch for an org (manual backup from photo library). */
export async function runNasBackupBatch(input: {
  organizationId: string;
  limit?: number;
  skipAgeGate?: boolean;
}): Promise<{
  enqueued: number;
  completed: number;
  failed: number;
  remaining: number;
}> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const candidates = await selectPhotosForNasMirror(limit, {
    organizationId: input.organizationId,
    skipAgeGate: input.skipAgeGate ?? true,
  });

  for (const row of candidates) {
    await enqueuePhotoJob({
      photoId: row.photoId,
      organizationId: row.organizationId,
      jobType: 'nas_mirror',
    });
  }

  const jobs = await claimPendingJobs('nas_mirror', limit);
  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      await runNasMirrorJob(job);
      await completePhotoJob(job.id);
      if (job.organizationId === input.organizationId) completed++;
    } catch (err) {
      if (job.organizationId === input.organizationId) failed++;
      await failPhotoJob(
        job.id,
        err instanceof Error ? err.message : 'nas mirror failed',
        job.attempts,
      );
    }
  }

  const remaining = await countPendingNasMirror(input.organizationId);
  return { enqueued: candidates.length, completed, failed, remaining };
}
