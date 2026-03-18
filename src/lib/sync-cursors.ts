import pool from '@/lib/db';

export type SyncCursorRow = {
  resource: string;
  last_synced_at: string | null;
  updated_at: string | null;
};

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
  await pool.query(
    `INSERT INTO sync_cursors (resource, last_synced_at)
     VALUES ($1, $2)
     ON CONFLICT (resource) DO UPDATE SET
       last_synced_at = EXCLUDED.last_synced_at,
       updated_at = NOW()`,
    [resource, lastSyncedAt.toISOString()]
  );
}
