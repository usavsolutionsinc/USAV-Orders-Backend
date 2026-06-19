import type { PoolClient } from 'pg';
import { photoContentUrl } from './display-url';
import { createPhotoEntityLink } from './links';
import type { PhotoEntityType, PhotoLinkRole } from './types';

export interface InsertPhotoCatalogInput {
  organizationId: string;
  staffId: number | null;
  photoType?: string | null;
  poRef?: string | null;
}

/** Insert a catalog row (no entity columns — links + storage hold relationships/bytes). */
export async function insertPhotoCatalog(
  client: PoolClient,
  input: InsertPhotoCatalogInput,
): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO photos (taken_by_staff_id, photo_type, organization_id, po_ref)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [input.staffId, input.photoType ?? null, input.organizationId, input.poRef ?? null],
  );
  return Number(rows[0].id);
}

export async function findPhotoByEntityLegacyUrl(
  client: PoolClient,
  input: {
    organizationId: string;
    entityType: PhotoEntityType;
    entityId: number;
    legacyUrl: string;
    linkRole?: PhotoLinkRole;
  },
): Promise<number | null> {
  const role = input.linkRole ?? 'primary';
  const res = await client.query<{ id: string }>(
    `SELECT p.id
       FROM photos p
       JOIN photo_entity_links l
         ON l.photo_id = p.id AND l.organization_id = p.organization_id
       JOIN photo_storage ps
         ON ps.photo_id = p.id AND ps.organization_id = p.organization_id AND ps.is_primary
      WHERE p.organization_id = $1
        AND l.entity_type = $2
        AND l.entity_id = $3
        AND l.link_role = $4
        AND ps.legacy_url = $5
      LIMIT 1`,
    [input.organizationId, input.entityType, input.entityId, role, input.legacyUrl],
  );
  return res.rows[0] ? Number(res.rows[0].id) : null;
}

export function photoDisplayUrls(photoId: number) {
  return {
    url: photoContentUrl(photoId),
    thumbUrl: photoContentUrl(photoId, 'thumb'),
  };
}
