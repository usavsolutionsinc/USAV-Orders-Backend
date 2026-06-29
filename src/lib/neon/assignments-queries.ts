import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

// ─── Tenancy note ────────────────────────────────────────────────────────────
// `work_assignments` is tenant-owned (organization_id NOT NULL) with RLS FORCE +
// a tenant_isolation policy (live catalog, docs/tenancy/org-id-coverage.generated.md).
// Every statement runs via `tenantQuery` under the per-request `app.current_org`
// GUC — RLS is the primary enforcement — AND carries an explicit
// `organization_id = $org` predicate (defense-in-depth, so a cross-org id is a
// no-op even if a future caller runs on the BYPASSRLS owner pool). Every export
// requires the request's orgId.
//
// Follow-up: the `(entity_type, entity_id, work_type)` unique key on
// upsertAssignment is NOT composited with organization_id. It is safe today only
// because entity_id references globally-unique PKs (orders.id, etc.); make it
// `(organization_id, entity_type, entity_id, work_type)` in a migration to remove
// that latent assumption.

export type WorkType = 'TEST' | 'PACK' | 'REPAIR' | 'QA' | 'RECEIVE' | 'STOCK_REPLENISH';
export type EntityType = 'ORDER' | 'REPAIR' | 'FBA_SHIPMENT' | 'RECEIVING' | 'SKU_STOCK';
export type AssignmentStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';

export interface WorkAssignment {
  id: number;
  entity_type: EntityType;
  entity_id: number;
  work_type: WorkType;
  assigned_tech_id: number | null;
  assigned_packer_id: number | null;
  completed_by_tech_id: number | null;
  status: AssignmentStatus;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface CreateAssignmentParams {
  /** Phase 3b: tenant scope required for the INSERT. */
  organizationId: string;
  entityType: EntityType;
  entityId: number;
  workType: WorkType;
  assignedTechId?: number | null;
  assignedPackerId?: number | null;
  status?: AssignmentStatus;
  notes?: string | null;
  deadlineAt?: string | null;
}

export interface UpdateAssignmentParams {
  status?: AssignmentStatus;
  assignedTechId?: number | null;
  assignedPackerId?: number | null;
  completedByTechId?: number | null;
  completedByPackerId?: number | null;
  priority?: number;
  notes?: string | null;
}

/**
 * Get all work assignments with optional filters (org-scoped).
 */
export async function getAssignments(
  filters: {
    entityType?: EntityType;
    entityId?: number;
    workType?: WorkType;
    status?: AssignmentStatus;
    assignedTechId?: number;
    assignedPackerId?: number;
    limit?: number;
    offset?: number;
  } | undefined,
  orgId: OrgId,
): Promise<WorkAssignment[]> {
  const conditions: string[] = ['organization_id = $1'];
  const params: any[] = [orgId];
  let idx = 2;

  if (filters?.entityType) { conditions.push(`entity_type = $${idx++}`); params.push(filters.entityType); }
  if (filters?.entityId != null) { conditions.push(`entity_id = $${idx++}`); params.push(filters.entityId); }
  if (filters?.workType) { conditions.push(`work_type = $${idx++}`); params.push(filters.workType); }
  if (filters?.status) { conditions.push(`status = $${idx++}`); params.push(filters.status); }
  if (filters?.assignedTechId != null) { conditions.push(`assigned_tech_id = $${idx++}`); params.push(filters.assignedTechId); }
  if (filters?.assignedPackerId != null) { conditions.push(`assigned_packer_id = $${idx++}`); params.push(filters.assignedPackerId); }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const limit = filters?.limit ?? 100;
  const offset = filters?.offset ?? 0;
  params.push(limit, offset);

  const result = await tenantQuery<WorkAssignment>(
    orgId,
    `SELECT * FROM work_assignments ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
    params,
  );
  return result.rows;
}

export interface WorkAssignmentWithStaff extends WorkAssignment {
  assigned_tech_name: string | null;
  assigned_packer_name: string | null;
}

/**
 * Get assignments with staff names joined (org-scoped).
 */
export async function getAssignmentsWithStaff(
  filters: {
    entityType?: EntityType;
    entityId?: number;
    workType?: WorkType;
    status?: AssignmentStatus;
    assignedTechId?: number;
    assignedPackerId?: number;
    includeClosed?: boolean;
    limit?: number;
  } | undefined,
  orgId: OrgId,
): Promise<WorkAssignmentWithStaff[]> {
  const conditions: string[] = ['wa.organization_id = $1'];
  const params: any[] = [orgId];
  let idx = 2;

  if (filters?.entityType) { conditions.push(`wa.entity_type = $${idx++}`); params.push(filters.entityType); }
  if (filters?.entityId != null) { conditions.push(`wa.entity_id = $${idx++}`); params.push(filters.entityId); }
  if (filters?.workType) { conditions.push(`wa.work_type = $${idx++}`); params.push(filters.workType); }
  if (filters?.status) {
    conditions.push(`wa.status = $${idx++}`); params.push(filters.status);
  } else if (!filters?.includeClosed) {
    conditions.push(`wa.status IN ('ASSIGNED', 'IN_PROGRESS')`);
  }
  if (filters?.assignedTechId != null) { conditions.push(`wa.assigned_tech_id = $${idx++}`); params.push(filters.assignedTechId); }
  if (filters?.assignedPackerId != null) { conditions.push(`wa.assigned_packer_id = $${idx++}`); params.push(filters.assignedPackerId); }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const limit = filters?.limit ?? 100;
  params.push(limit);

  const result = await tenantQuery<WorkAssignmentWithStaff>(
    orgId,
    `SELECT
       wa.*,
       st.name AS assigned_tech_name,
       sp.name AS assigned_packer_name
     FROM work_assignments wa
     LEFT JOIN staff st ON st.id = wa.assigned_tech_id
     LEFT JOIN staff sp ON sp.id = wa.assigned_packer_id
     ${where}
     ORDER BY wa.priority ASC, wa.created_at ASC
     LIMIT $${idx}`,
    params,
  );
  return result.rows;
}

/**
 * Get a single work assignment by ID (org-scoped).
 */
export async function getAssignmentById(id: number, orgId: OrgId): Promise<WorkAssignment | null> {
  const result = await tenantQuery<WorkAssignment>(
    orgId,
    'SELECT * FROM work_assignments WHERE id = $1 AND organization_id = $2',
    [id, orgId],
  );
  return result.rows[0] ?? null;
}

/**
 * Get the active assignment for an entity + work type (org-scoped).
 */
export async function getActiveAssignment(
  entityType: EntityType,
  entityId: number,
  workType: WorkType,
  orgId: OrgId,
): Promise<WorkAssignment | null> {
  const result = await tenantQuery<WorkAssignment>(
    orgId,
    `SELECT * FROM work_assignments
     WHERE entity_type = $1 AND entity_id = $2 AND work_type = $3
       AND organization_id = $4
       AND status IN ('ASSIGNED', 'IN_PROGRESS')
     ORDER BY created_at DESC LIMIT 1`,
    [entityType, entityId, workType, orgId],
  );
  return result.rows[0] ?? null;
}

/**
 * Get the next unassigned entity ID of a given type/work type (org-scoped).
 */
export async function getNextUnassignedEntityId(
  entityType: EntityType,
  workType: WorkType,
  orgId: OrgId,
  excludeId?: number,
): Promise<number | null> {
  const params: any[] = [entityType, workType, orgId];
  let idx = 4;
  const excludeClause = excludeId != null ? `AND entity_id != $${idx++}` : '';
  if (excludeId != null) params.push(excludeId);

  const result = await tenantQuery<{ entity_id: number }>(
    orgId,
    `SELECT entity_id FROM work_assignments
     WHERE entity_type = $1 AND work_type = $2 AND organization_id = $3
       AND status = 'ASSIGNED' ${excludeClause}
     ORDER BY created_at ASC LIMIT 1`,
    params,
  );
  return result.rows[0]?.entity_id ?? null;
}

/**
 * Create a new work assignment. organization_id is stamped from params and the
 * statement runs under that org's GUC.
 */
export async function createAssignment(params: CreateAssignmentParams): Promise<WorkAssignment> {
  const result = await tenantQuery<WorkAssignment>(
    params.organizationId,
    `INSERT INTO work_assignments
       (organization_id, entity_type, entity_id, work_type, assigned_tech_id, assigned_packer_id, status, notes, deadline_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      params.organizationId,
      params.entityType,
      params.entityId,
      params.workType,
      params.assignedTechId ?? null,
      params.assignedPackerId ?? null,
      params.status ?? 'ASSIGNED',
      params.notes ?? null,
      params.deadlineAt ?? null,
    ],
  );
  return result.rows[0];
}

/**
 * Upsert a work assignment (insert or update on conflict).
 */
export async function upsertAssignment(params: CreateAssignmentParams): Promise<WorkAssignment> {
  const result = await tenantQuery<WorkAssignment>(
    params.organizationId,
    `INSERT INTO work_assignments
       (organization_id, entity_type, entity_id, work_type, assigned_tech_id, assigned_packer_id, status, notes, deadline_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (entity_type, entity_id, work_type)
     DO UPDATE SET
       assigned_tech_id   = EXCLUDED.assigned_tech_id,
       assigned_packer_id = EXCLUDED.assigned_packer_id,
       status             = EXCLUDED.status,
       notes              = EXCLUDED.notes,
       deadline_at        = EXCLUDED.deadline_at,
       updated_at         = NOW()
     RETURNING *`,
    [
      params.organizationId,
      params.entityType,
      params.entityId,
      params.workType,
      params.assignedTechId ?? null,
      params.assignedPackerId ?? null,
      params.status ?? 'ASSIGNED',
      params.notes ?? null,
      params.deadlineAt ?? null,
    ],
  );
  return result.rows[0];
}

/**
 * Update a work assignment by ID (org-scoped).
 */
export async function updateAssignment(
  id: number,
  updates: UpdateAssignmentParams,
  orgId: OrgId,
): Promise<WorkAssignment | null> {
  const setClauses: string[] = ['updated_at = NOW()'];
  const params: any[] = [];
  let idx = 1;

  if (updates.status !== undefined) {
    setClauses.push(`status = $${idx++}`); params.push(updates.status);
    if (updates.status === 'IN_PROGRESS') setClauses.push(`started_at = COALESCE(started_at, NOW())`);
    if (updates.status === 'DONE' || updates.status === 'CANCELED') setClauses.push(`completed_at = COALESCE(completed_at, NOW())`);
  }
  if (updates.assignedTechId !== undefined) { setClauses.push(`assigned_tech_id = $${idx++}`); params.push(updates.assignedTechId); }
  if (updates.assignedPackerId !== undefined) { setClauses.push(`assigned_packer_id = $${idx++}`); params.push(updates.assignedPackerId); }
  if (updates.completedByTechId !== undefined) { setClauses.push(`completed_by_tech_id = $${idx++}`); params.push(updates.completedByTechId); }
  if (updates.completedByPackerId !== undefined) { setClauses.push(`completed_by_packer_id = $${idx++}`); params.push(updates.completedByPackerId); }
  if (updates.priority !== undefined) { setClauses.push(`priority = $${idx++}`); params.push(updates.priority); }
  if (updates.notes !== undefined) { setClauses.push(`notes = $${idx++}`); params.push(updates.notes); }

  const idParam = idx++;
  params.push(id);
  const orgParam = idx;
  params.push(orgId);

  const result = await tenantQuery<WorkAssignment>(
    orgId,
    `UPDATE work_assignments SET ${setClauses.join(', ')} WHERE id = $${idParam} AND organization_id = $${orgParam} RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

/**
 * Delete a work assignment by ID (org-scoped).
 */
export async function deleteAssignment(id: number, orgId: OrgId): Promise<boolean> {
  const result = await tenantQuery(
    orgId,
    'DELETE FROM work_assignments WHERE id = $1 AND organization_id = $2',
    [id, orgId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Delete all assignments for an entity (org-scoped).
 */
export async function deleteAssignmentsForEntity(
  entityType: EntityType,
  entityId: number,
  orgId: OrgId,
): Promise<number> {
  const result = await tenantQuery(
    orgId,
    'DELETE FROM work_assignments WHERE entity_type = $1 AND entity_id = $2 AND organization_id = $3',
    [entityType, entityId, orgId],
  );
  return result.rowCount ?? 0;
}
