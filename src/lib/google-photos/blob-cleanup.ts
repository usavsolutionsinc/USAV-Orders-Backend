import { del } from '@vercel/blob';
import pool from '@/lib/db';

export interface BlobCleanupResult {
  scanned: number;
  deleted: number;
  failed: number;
  errors: Array<{ photoId: number; message: string }>;
}

function isVercelBlobUrl(url: string): boolean {
  // @vercel/blob URLs live on either *.public.blob.vercel-storage.com or
  // legacy *.blob.vercel-storage.com hosts. Anything else (e.g. test data
  // pointing at example.com) is skipped — we only delete what we own.
  return /(^https:\/\/[^/]*\.?)?blob\.vercel-storage\.com/.test(url);
}

export async function runBlobCleanup(params: {
  afterDays: number;
  limit?: number;
}): Promise<BlobCleanupResult> {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const result: BlobCleanupResult = { scanned: 0, deleted: 0, failed: 0, errors: [] };

  const { rows } = await pool.query<{ id: number; url: string }>(
    `SELECT id, url
     FROM photos
     WHERE google_photos_id      IS NOT NULL
       AND deleted_from_blob_at  IS NULL
       AND uploaded_to_google_at <  NOW() - ($1 || ' days')::interval
     ORDER BY uploaded_to_google_at ASC
     LIMIT $2`,
    [String(params.afterDays), limit],
  );

  result.scanned = rows.length;

  for (const row of rows) {
    if (!isVercelBlobUrl(row.url)) {
      // Not a Vercel Blob URL — just mark so we don't re-scan it forever.
      await pool.query(
        `UPDATE photos SET deleted_from_blob_at = NOW() WHERE id = $1`,
        [row.id],
      );
      continue;
    }
    try {
      await del(row.url);
      await pool.query(
        `UPDATE photos SET deleted_from_blob_at = NOW() WHERE id = $1`,
        [row.id],
      );
      result.deleted += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push({
        photoId: row.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
