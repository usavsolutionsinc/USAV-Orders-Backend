import pool from '@/lib/db';

export type PhotoJobType = 'analyze' | 'nas_mirror' | 'export_drive';
export type PhotoJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface PhotoJobRow {
  id: number;
  photoId: number;
  organizationId: string;
  jobType: PhotoJobType;
  status: PhotoJobStatus;
  attempts: number;
  lastError: string | null;
}

const MAX_ATTEMPTS = Number(process.env.PHOTOS_JOB_MAX_ATTEMPTS || 5);

export async function enqueuePhotoJob(input: {
  photoId: number;
  organizationId: string;
  jobType: PhotoJobType;
}): Promise<void> {
  await pool.query(
    `INSERT INTO photo_jobs (photo_id, organization_id, job_type, status, scheduled_at)
     SELECT $1, $2, $3, 'pending', NOW()
     WHERE NOT EXISTS (
       SELECT 1 FROM photo_jobs
        WHERE photo_id = $1 AND job_type = $3 AND status IN ('pending', 'running')
     )`,
    [input.photoId, input.organizationId, input.jobType],
  );
}

export async function claimPendingJobs(
  jobType: PhotoJobType,
  limit: number,
): Promise<PhotoJobRow[]> {
  const res = await pool.query<{
    id: string;
    photo_id: string;
    organization_id: string;
    job_type: PhotoJobType;
    status: PhotoJobStatus;
    attempts: number;
    last_error: string | null;
  }>(
    `UPDATE photo_jobs
        SET status = 'running', attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM photo_jobs
         WHERE job_type = $1
           AND status = 'pending'
           AND attempts < $3
         ORDER BY scheduled_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, photo_id, organization_id, job_type, status, attempts, last_error`,
    [jobType, limit, MAX_ATTEMPTS],
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    photoId: Number(r.photo_id),
    organizationId: r.organization_id,
    jobType: r.job_type,
    status: r.status,
    attempts: r.attempts,
    lastError: r.last_error,
  }));
}

export async function completePhotoJob(jobId: number): Promise<void> {
  await pool.query(
    `UPDATE photo_jobs SET status = 'completed', completed_at = NOW(), last_error = NULL WHERE id = $1`,
    [jobId],
  );
}

export async function failPhotoJob(jobId: number, error: string, attempts = 1): Promise<void> {
  await pool.query(
    `UPDATE photo_jobs
        SET status = CASE WHEN attempts >= $3 THEN 'failed' ELSE 'pending' END,
            last_error = $2,
            scheduled_at = NOW() + (LEAST($4, 60) * INTERVAL '1 minute')
      WHERE id = $1`,
    [jobId, error.slice(0, 2000), MAX_ATTEMPTS, attempts * 2],
  );
}
