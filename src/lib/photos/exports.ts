import pool from '@/lib/db';

export type PhotoExportProvider = 'google_photos' | 'google_drive';

export interface RecordPhotoExportInput {
  organizationId: string;
  photoId?: number | null;
  sharePackId?: number | null;
  provider: PhotoExportProvider;
  externalId?: string | null;
  externalUrl?: string | null;
  providerMeta?: Record<string, unknown>;
}

/** Record an external export push (Google Drive / Photos). v1 stub for Phase 5+. */
export async function recordPhotoExport(input: RecordPhotoExportInput): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO photo_exports
       (photo_id, share_pack_id, organization_id, provider, external_id, external_url, provider_meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      input.photoId ?? null,
      input.sharePackId ?? null,
      input.organizationId,
      input.provider,
      input.externalId ?? null,
      input.externalUrl ?? null,
      JSON.stringify(input.providerMeta ?? {}),
    ],
  );
  return Number(res.rows[0].id);
}

export async function listPhotoExportsForPack(
  organizationId: string,
  sharePackId: number,
): Promise<Array<{ id: number; provider: PhotoExportProvider; externalUrl: string | null }>> {
  const res = await pool.query<{
    id: string;
    provider: PhotoExportProvider;
    external_url: string | null;
  }>(
    `SELECT id, provider, external_url
       FROM photo_exports
      WHERE organization_id = $1 AND share_pack_id = $2
      ORDER BY exported_at DESC`,
    [organizationId, sharePackId],
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    provider: r.provider,
    externalUrl: r.external_url,
  }));
}
