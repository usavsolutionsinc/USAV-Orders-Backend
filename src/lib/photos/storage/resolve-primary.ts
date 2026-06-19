import pool from '@/lib/db';
import type { PhotoStorageRow } from './types';

interface DbRow {
  id: string;
  photo_id: string;
  organization_id: string;
  provider: PhotoStorageRow['provider'];
  bucket: string | null;
  object_key: string;
  thumb_object_key: string | null;
  content_type: string | null;
  file_size_bytes: number | null;
  sha256_hex: string | null;
  legacy_url: string | null;
  provider_meta: Record<string, unknown> | null;
  is_primary: boolean;
}

function mapRow(row: DbRow): PhotoStorageRow {
  return {
    id: Number(row.id),
    photoId: Number(row.photo_id),
    organizationId: row.organization_id,
    provider: row.provider,
    bucket: row.bucket,
    objectKey: row.object_key,
    thumbObjectKey: row.thumb_object_key,
    contentType: row.content_type,
    fileSizeBytes: row.file_size_bytes,
    sha256Hex: row.sha256_hex,
    legacyUrl: row.legacy_url,
    providerMeta: row.provider_meta ?? {},
    isPrimary: row.is_primary,
  };
}

export async function getPrimaryPhotoStorage(
  photoId: number,
  organizationId?: string,
): Promise<PhotoStorageRow | null> {
  const params: unknown[] = [photoId];
  let orgClause = '';
  if (organizationId) {
    orgClause = ' AND organization_id = $2';
    params.push(organizationId);
  }
  const res = await pool.query<DbRow>(
    `SELECT id, photo_id, organization_id, provider, bucket, object_key,
            thumb_object_key, content_type, file_size_bytes, sha256_hex,
            legacy_url, provider_meta, is_primary
       FROM photo_storage
      WHERE photo_id = $1 AND is_primary = TRUE${orgClause}
      LIMIT 1`,
    params,
  );
  return res.rows[0] ? mapRow(res.rows[0]) : null;
}

export async function getPhotoStorageRows(
  photoId: number,
  organizationId: string,
): Promise<PhotoStorageRow[]> {
  const res = await pool.query<DbRow>(
    `SELECT id, photo_id, organization_id, provider, bucket, object_key,
            thumb_object_key, content_type, file_size_bytes, sha256_hex,
            legacy_url, provider_meta, is_primary
       FROM photo_storage
      WHERE photo_id = $1 AND organization_id = $2
      ORDER BY is_primary DESC, id ASC`,
    [photoId, organizationId],
  );
  return res.rows.map(mapRow);
}

export async function getDefaultStorageProvider(
  organizationId: string,
): Promise<{ provider: PhotoStorageRow['provider']; config: Record<string, unknown> }> {
  const res = await pool.query<{ provider: PhotoStorageRow['provider']; config: Record<string, unknown> }>(
    `SELECT provider, config
       FROM photo_storage_providers
      WHERE organization_id = $1 AND is_default = TRUE
      LIMIT 1`,
    [organizationId],
  );
  if (res.rows[0]) return res.rows[0];
  const envProvider = (process.env.PHOTOS_DEFAULT_PROVIDER || 'gcs') as PhotoStorageRow['provider'];
  return {
    provider: envProvider,
    config: { bucket: process.env.PHOTOS_GCS_BUCKET || 'usav-photos-dev' },
  };
}
