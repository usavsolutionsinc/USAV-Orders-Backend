import pool from '@/lib/db';
import { transitionalUsavOrgId } from '@/lib/tenancy/db';

export async function getSyncCursor(resource: string): Promise<Date | null> {
  const res = await pool.query<{ last_synced_at: string | null }>(
    `SELECT last_synced_at
     FROM sync_cursors
     WHERE resource = $1
     LIMIT 1`,
    [resource]
  ).catch(() => ({ rows: [] as Array<{ last_synced_at: string | null }> }));

  const raw = res.rows[0]?.last_synced_at;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function updateSyncCursor(resource: string, lastSyncedAt: Date): Promise<void> {
  // sync_cursors is tenant-owned with a usav-fallback default; these helpers are
  // driven by session-less syncs/jobs with no request org, so stamp the
  // transitional USAV org explicitly (the established single-tenant convention).
  await pool.query(
    `INSERT INTO sync_cursors (resource, last_synced_at, organization_id)
     VALUES ($1, $2, $3::uuid)
     ON CONFLICT (resource) DO UPDATE SET
       last_synced_at = EXCLUDED.last_synced_at,
       updated_at = NOW()`,
    [resource, lastSyncedAt.toISOString(), transitionalUsavOrgId()]
  );
}
