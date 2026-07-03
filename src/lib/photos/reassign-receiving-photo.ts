import { withTenantTransaction } from '@/lib/tenancy/db';
import { resolvePoRef } from './resolve-po-ref';
import type { PhotoEntityType } from './types';

export class PhotoReassignError extends Error {
  readonly status: 400 | 404 | 409;

  constructor(message: string, status: 400 | 404 | 409) {
    super(message);
    this.name = 'PhotoReassignError';
    this.status = status;
  }
}

export interface ReassignReceivingPhotoInput {
  organizationId: string;
  photoId: number;
  targetEntityType: 'RECEIVING' | 'RECEIVING_LINE';
  targetEntityId: number;
}

export interface ReassignReceivingPhotoScope {
  entityType: 'RECEIVING' | 'RECEIVING_LINE';
  entityId: number;
  receivingId: number;
  receivingLineId: number | null;
}

export interface ReassignReceivingPhotoResult {
  photoId: number;
  from: ReassignReceivingPhotoScope;
  to: ReassignReceivingPhotoScope;
  idempotent: boolean;
}

export interface ReassignReceivingPhotoDeps {
  loadPrimaryLink: (
    organizationId: string,
    photoId: number,
  ) => Promise<ReassignReceivingPhotoScope | null>;
  resolveTarget: (
    organizationId: string,
    entityType: 'RECEIVING' | 'RECEIVING_LINE',
    entityId: number,
  ) => Promise<ReassignReceivingPhotoScope | null>;
  updateAssignment: (input: {
    organizationId: string;
    photoId: number;
    targetEntityType: 'RECEIVING' | 'RECEIVING_LINE';
    targetEntityId: number;
    poRef: string | null;
  }) => Promise<void>;
}

async function loadPrimaryLinkImpl(
  organizationId: string,
  photoId: number,
): Promise<ReassignReceivingPhotoScope | null> {
  return withTenantTransaction(organizationId, async (client) => {
    const res = await client.query<{
      entity_type: string;
      entity_id: string;
      receiving_id_resolved: string | null;
    }>(
      `SELECT
         l.entity_type,
         l.entity_id,
         CASE
           WHEN l.entity_type = 'RECEIVING' THEN l.entity_id
           WHEN l.entity_type = 'RECEIVING_LINE' THEN rl.receiving_id
           ELSE NULL
         END AS receiving_id_resolved
         FROM photos p
         JOIN photo_entity_links l
           ON l.photo_id = p.id
          AND l.organization_id = p.organization_id
          AND l.link_role = 'primary'
         LEFT JOIN receiving_lines rl
           ON l.entity_type = 'RECEIVING_LINE' AND rl.id = l.entity_id
        WHERE p.id = $1
          AND p.organization_id = $2
          AND l.entity_type IN ('RECEIVING', 'RECEIVING_LINE')`,
      [photoId, organizationId],
    );
    const row = res.rows[0];
    if (!row) return null;
    const entityType = row.entity_type as 'RECEIVING' | 'RECEIVING_LINE';
    const entityId = Number(row.entity_id);
    const receivingId =
      row.receiving_id_resolved != null ? Number(row.receiving_id_resolved) : null;
    if (receivingId == null || !Number.isFinite(receivingId)) return null;
    return {
      entityType,
      entityId,
      receivingId,
      receivingLineId: entityType === 'RECEIVING_LINE' ? entityId : null,
    };
  });
}

async function resolveTargetImpl(
  organizationId: string,
  entityType: 'RECEIVING' | 'RECEIVING_LINE',
  entityId: number,
): Promise<ReassignReceivingPhotoScope | null> {
  return withTenantTransaction(organizationId, async (client) => {
    if (entityType === 'RECEIVING') {
      const res = await client.query<{ id: string }>(
        `SELECT id FROM receiving WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [entityId, organizationId],
      );
      if (res.rowCount === 0) return null;
      return {
        entityType: 'RECEIVING',
        entityId,
        receivingId: entityId,
        receivingLineId: null,
      };
    }

    const res = await client.query<{ id: string; receiving_id: string }>(
      `SELECT id, receiving_id
         FROM receiving_lines
        WHERE id = $1 AND organization_id = $2
        LIMIT 1`,
      [entityId, organizationId],
    );
    const row = res.rows[0];
    if (!row) return null;
    const receivingId = Number(row.receiving_id);
    if (!Number.isFinite(receivingId) || receivingId <= 0) return null;
    return {
      entityType: 'RECEIVING_LINE',
      entityId,
      receivingId,
      receivingLineId: entityId,
    };
  });
}

async function updateAssignmentImpl(input: {
  organizationId: string;
  photoId: number;
  targetEntityType: PhotoEntityType;
  targetEntityId: number;
  poRef: string | null;
}): Promise<void> {
  await withTenantTransaction(input.organizationId, async (client) => {
    const updated = await client.query(
      `UPDATE photo_entity_links
          SET entity_type = $3,
              entity_id = $4
        WHERE photo_id = $1
          AND organization_id = $2
          AND link_role = 'primary'`,
      [
        input.photoId,
        input.organizationId,
        input.targetEntityType,
        input.targetEntityId,
      ],
    );
    if (updated.rowCount === 0) {
      throw new PhotoReassignError('Primary photo link not found', 404);
    }
    await client.query(
      `UPDATE photos
          SET po_ref = $3,
              updated_at = NOW()
        WHERE id = $1 AND organization_id = $2`,
      [input.photoId, input.organizationId, input.poRef],
    );
  });
}

const defaultDeps: ReassignReceivingPhotoDeps = {
  loadPrimaryLink: loadPrimaryLinkImpl,
  resolveTarget: resolveTargetImpl,
  updateAssignment: updateAssignmentImpl,
};

function scopesMatch(
  a: ReassignReceivingPhotoScope,
  b: ReassignReceivingPhotoScope,
): boolean {
  return a.entityType === b.entityType && a.entityId === b.entityId;
}

export async function reassignReceivingPhoto(
  input: ReassignReceivingPhotoInput,
  deps: ReassignReceivingPhotoDeps = defaultDeps,
): Promise<ReassignReceivingPhotoResult> {
  const current = await deps.loadPrimaryLink(input.organizationId, input.photoId);
  if (!current) {
    throw new PhotoReassignError('Photo not found or not a receiving photo', 404);
  }

  const target = await deps.resolveTarget(
    input.organizationId,
    input.targetEntityType,
    input.targetEntityId,
  );
  if (!target) {
    throw new PhotoReassignError('Target PO or line not found', 404);
  }

  if (scopesMatch(current, target)) {
    return {
      photoId: input.photoId,
      from: current,
      to: target,
      idempotent: true,
    };
  }

  const poRef = await resolvePoRef(input.targetEntityType, input.targetEntityId);
  await deps.updateAssignment({
    organizationId: input.organizationId,
    photoId: input.photoId,
    targetEntityType: input.targetEntityType,
    targetEntityId: input.targetEntityId,
    poRef,
  });

  return {
    photoId: input.photoId,
    from: current,
    to: target,
    idempotent: false,
  };
}
