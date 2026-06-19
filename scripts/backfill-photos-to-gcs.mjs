#!/usr/bin/env node
/**
 * Backfill legacy photos.url rows to GCS primary storage + photo_storage rows.
 *
 *   node scripts/backfill-photos-to-gcs.mjs --dry
 *   node scripts/backfill-photos-to-gcs.mjs --limit=100
 */
import pg from 'pg';
import { createHash } from 'node:crypto';

const dry = process.argv.includes('--dry');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 50;

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const bucket = process.env.PHOTOS_GCS_BUCKET?.trim();
const credJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim();

if (!connectionString) {
  console.error('DATABASE_URL required');
  process.exit(1);
}
if (!dry && (!bucket || !credJson)) {
  console.error('PHOTOS_GCS_BUCKET and GOOGLE_APPLICATION_CREDENTIALS_JSON required');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString });

async function fetchLegacyBytes(url) {
  if (!url || url.startsWith('/api/photos/')) return null;
  if (/^https?:\/\//i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return {
      buffer: Buffer.from(ab),
      contentType: res.headers.get('content-type') || 'image/jpeg',
    };
  }
  return null;
}

async function main() {
  const res = await pool.query(
    `SELECT p.id, p.organization_id, p.entity_type, p.entity_id, p.url, p.po_ref
       FROM photos p
      WHERE p.url IS NOT NULL
        AND p.url NOT LIKE '/api/photos/%'
        AND NOT EXISTS (
          SELECT 1 FROM photo_storage ps
           WHERE ps.photo_id = p.id AND ps.provider = 'gcs' AND ps.is_primary = TRUE
        )
      ORDER BY p.created_at ASC
      LIMIT $1`,
    [limit],
  );

  console.log(`Candidates: ${res.rowCount}`);
  if (dry) {
    for (const row of res.rows) console.log(`  ${row.id} ${row.url}`);
    return;
  }

  const { Storage } = await import('@google-cloud/storage');
  const storage = new Storage({
    credentials: JSON.parse(credJson),
    projectId: process.env.PHOTOS_GCS_PROJECT_ID,
  });
  const b = storage.bucket(bucket);

  let uploaded = 0;
  for (const row of res.rows) {
    const legacy = await fetchLegacyBytes(String(row.url));
    if (!legacy) continue;

    const objectKey = `${row.organization_id}/backfill/${row.id}.jpg`;
    const sha256Hex = createHash('sha256').update(legacy.buffer).digest('hex');
    await b.file(objectKey).save(legacy.buffer, {
      contentType: legacy.contentType,
      resumable: false,
    });

    const contentUrl = `/api/photos/${row.id}/content`;
    await pool.query('BEGIN');
    try {
      await pool.query(`UPDATE photos SET url = $1, updated_at = NOW() WHERE id = $2`, [
        contentUrl,
        row.id,
      ]);
      await pool.query(
        `INSERT INTO photo_storage
           (photo_id, organization_id, provider, bucket, object_key, legacy_url,
            content_type, file_size_bytes, sha256_hex, is_primary)
         VALUES ($1, $2, 'gcs', $3, $4, $5, $6, $7, $8, TRUE)`,
        [
          row.id,
          row.organization_id,
          bucket,
          objectKey,
          row.url,
          legacy.contentType,
          legacy.buffer.length,
          sha256Hex,
        ],
      );
      await pool.query('COMMIT');
      uploaded++;
    } catch (err) {
      await pool.query('ROLLBACK');
      console.warn(`photo ${row.id} failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`Uploaded ${uploaded}/${res.rowCount}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
