import type { PoolClient } from 'pg';
import type { PhotoEntityType, PhotoLinkRole } from './types';

export interface CreateLinkInput {
  photoId: number;
  organizationId: string;
  entityType: PhotoEntityType;
  entityId: number;
  linkRole?: PhotoLinkRole;
}

export async function createPhotoEntityLink(
  client: PoolClient,
  input: CreateLinkInput,
): Promise<void> {
  await client.query(
    `INSERT INTO photo_entity_links
       (photo_id, organization_id, entity_type, entity_id, link_role)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (photo_id, entity_type, entity_id, link_role) DO NOTHING`,
    [
      input.photoId,
      input.organizationId,
      input.entityType,
      input.entityId,
      input.linkRole ?? 'primary',
    ],
  );
}

export async function listLinksForPhoto(
  client: PoolClient,
  photoId: number,
  organizationId: string,
): Promise<Array<{ entityType: PhotoEntityType; entityId: number; linkRole: PhotoLinkRole }>> {
  const res = await client.query<{
    entity_type: PhotoEntityType;
    entity_id: string;
    link_role: PhotoLinkRole;
  }>(
    `SELECT entity_type, entity_id, link_role
       FROM photo_entity_links
      WHERE photo_id = $1 AND organization_id = $2
      ORDER BY created_at ASC`,
    [photoId, organizationId],
  );
  return res.rows.map((r) => ({
    entityType: r.entity_type,
    entityId: Number(r.entity_id),
    linkRole: r.link_role,
  }));
}
