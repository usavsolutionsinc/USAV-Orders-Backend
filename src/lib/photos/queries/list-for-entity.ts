import { photoContentUrl } from '../display-url';
import type { PhotoEntityType, PhotoLinkRole } from '../types';

export interface ListForEntityInput {
  organizationId: string;
  entityType: PhotoEntityType;
  entityId: number;
  linkRole?: PhotoLinkRole;
  /** When listing RECEIVING, also include RECEIVING_LINE photos under this receiving id. */
  receivingId?: number;
}

interface DbPhotoRow {
  id: string;
  organization_id: string;
  photo_type: string | null;
  taken_by_staff_id: number | null;
  po_ref: string | null;
  created_at: string;
}

export function mapPhotoRow(row: DbPhotoRow) {
  const id = Number(row.id);
  return {
    id,
    organizationId: row.organization_id,
    photoType: row.photo_type,
    takenByStaffId: row.taken_by_staff_id,
    poRef: row.po_ref,
    url: photoContentUrl(id),
    createdAt: row.created_at,
  };
}

/** Build WHERE clause for listing photos linked to an entity (photo_entity_links only). */
export function buildListForEntityQuery(input: ListForEntityInput): {
  where: string;
  params: unknown[];
  joins: string;
} {
  const params: unknown[] = [input.organizationId];
  const joins = `
    INNER JOIN photo_entity_links l ON l.photo_id = p.id AND l.organization_id = p.organization_id
    LEFT JOIN receiving_lines rl ON l.entity_type = 'RECEIVING_LINE' AND rl.id = l.entity_id
  `;

  if (input.entityType === 'RECEIVING' && input.receivingId) {
    params.push(input.receivingId);
    const rid = `$${params.length}`;
    params.push(input.entityId);
    const eid = `$${params.length}`;
    const where = `
      p.organization_id = $1
      AND (
        (l.entity_type = 'RECEIVING' AND l.entity_id = ${eid})
        OR (l.entity_type = 'RECEIVING_LINE' AND rl.receiving_id = ${rid})
      )`;
    return { where, params, joins };
  }

  params.push(input.entityType);
  const et = `$${params.length}`;
  params.push(input.entityId);
  const eid = `$${params.length}`;

  let roleClause = '';
  if (input.linkRole) {
    params.push(input.linkRole);
    roleClause = ` AND l.link_role = $${params.length}`;
  }

  const where = `
    p.organization_id = $1
    AND l.entity_type = ${et}
    AND l.entity_id = ${eid}${roleClause}`;

  return { where, params, joins };
}

export const PHOTO_SELECT = `
  DISTINCT ON (p.id) p.id, p.organization_id, p.photo_type, p.taken_by_staff_id,
  p.po_ref, p.created_at
`;
