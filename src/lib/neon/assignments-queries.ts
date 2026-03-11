import pool from '../db';

export type WorkType = 'TEST' | 'PACK' | 'REPAIR' | 'QA' | 'RECEIVE' | 'STOCK_REPLENISH';
export type EntityType = 'ORDER' | 'REPAIR' | 'FBA_SHIPMENT' | 'RECEIVING' | 'SKU_STOCK';
export type AssignmentStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';

export interface WorkAssignment {
  id: number;
  entity_type: EntityType;
  entity_id: number;
  work_type: WorkType;
  assigned_tech_id: number | null;
  assigned_packer_id: number | null;
  status: AssignmentStatus;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface CreateAssignmentParams {
  entityType: EntityType;
  entityId: number;
  workType: WorkType;
  assignedTechId?: number | null;
  assignedPackerId?: number | null;
  status?: AssignmentStatus;
  notes?: string | null;
}

export interface UpdateAssignmentParams {
  status?: AssignmentStatus;
  assignedTechId?: number | null;
  assignedPackerId?: number | null;
  notes?: string | null;
}

/**
 * Get all work assignments with optional filters
 */
export async function getAssignments(filters?: {
  entityType?: EntityType;
  entityId?: number;
  workType?: WorkType;
  status?: AssignmentStatus;
  assignedTechId?: number;
  assignedPackerId?: number;
  limit?: number;
  offset?: number;
}): Promise<WorkAssignment[]> {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (filters?.entityType) { conditions.push(`entity_type = $${idx++}`); params.push(filters.entityType); }
  if (filters?.entityId != null) { conditions.push(`entity_id = $${idx++}`); params.push(filters.entityId); }
  if (filters?.workType) { conditions.push(`work_type = $${idx++}`); params.push(filters.workType); }
  if (filters?.status) { conditions.push(`status = $${idx++}`); params.push(filters.status); }
  if (filters?.assignedTechId != null) { conditions.push(`assigned_tech_id = $${idx++}`); params.push(filters.assignedTechId); }
  if (filters?.assignedPackerId != null) { conditions.push(`assigned_packer_id = $${idx++}`); params.push(filters.assignedPackerId); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters?.limit ?? 100;
  const offset = filters?.offset ?? 0;
  params.push(limit, offset);

  const result = await pool.query(
    `SELECT * FROM work_assignments ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
    params,
  );
  return result.rows;
}

/**
 * Get a single work assignment by ID
 */
export async function getAssignmentById(id: number): Promise<WorkAssignment | null> {
  const result = await pool.query('SELECT * FROM work_assignments WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

/**
 * Get the active assignment for an entity + work type
 */
export async function getActiveAssignment(
  entityType: EntityType,
  entityId: number,
  workType: WorkType,
): Promise<WorkAssignment | null> {
  const result = await pool.query(
    `SELECT * FROM work_assignments
     WHERE entity_type = $1 AND entity_id = $2 AND work_type = $3
       AND status IN ('ASSIGNED', 'IN_PROGRESS')
     ORDER BY created_at DESC LIMIT 1`,
    [entityType, entityId, workType],
  );
  return result.rows[0] ?? null;
}

/**
 * Get the next unassigned entity ID of a given type/work type
 */
export async function getNextUnassignedEntityId(
  entityType: EntityType,
  workType: WorkType,
  excludeId?: number,
): Promise<number | null> {
  const excludeClause = excludeId != null ? 'AND entity_id != $3' : '';
  const params: any[] = [entityType, workType];
  if (excludeId != null) params.push(excludeId);

  const result = await pool.query(
    `SELECT entity_id FROM work_assignments
     WHERE entity_type = $1 AND work_type = $2 AND status = 'ASSIGNED' ${excludeClause}
     ORDER BY created_at ASC LIMIT 1`,
    params,
  );
  return result.rows[0]?.entity_id ?? null;
}

/**
 * Create a new work assignment
 */
export async function createAssignment(params: CreateAssignmentParams): Promise<WorkAssignment> {
  const result = await pool.query(
    `INSERT INTO work_assignments
       (entity_type, entity_id, work_type, assigned_tech_id, assigned_packer_id, status, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      params.entityType,
      params.entityId,
      params.workType,
      params.assignedTechId ?? null,
      params.assignedPackerId ?? null,
      params.status ?? 'ASSIGNED',
      params.notes ?? null,
    ],
  );
  return result.rows[0];
}

/**
 * Upsert a work assignment (insert or update on conflict)
 */
export async function upsertAssignment(params: CreateAssignmentParams): Promise<WorkAssignment> {
  const result = await pool.query(
    `INSERT INTO work_assignments
       (entity_type, entity_id, work_type, assigned_tech_id, assigned_packer_id, status, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (entity_type, entity_id, work_type)
     DO UPDATE SET
       assigned_tech_id   = EXCLUDED.assigned_tech_id,
       assigned_packer_id = EXCLUDED.assigned_packer_id,
       status             = EXCLUDED.status,
       notes              = EXCLUDED.notes,
       updated_at         = NOW()
     RETURNING *`,
    [
      params.entityType,
      params.entityId,
      params.workType,
      params.assignedTechId ?? null,
      params.assignedPackerId ?? null,
      params.status ?? 'ASSIGNED',
      params.notes ?? null,
    ],
  );
  return result.rows[0];
}

/**
 * Update a work assignment by ID
 */
export async function updateAssignment(id: number, updates: UpdateAssignmentParams): Promise<WorkAssignment | null> {
  const setClauses: string[] = ['updated_at = NOW()'];
  const params: any[] = [];
  let idx = 1;

  if (updates.status !== undefined) { setClauses.push(`status = $${idx++}`); params.push(updates.status); }
  if (updates.assignedTechId !== undefined) { setClauses.push(`assigned_tech_id = $${idx++}`); params.push(updates.assignedTechId); }
  if (updates.assignedPackerId !== undefined) { setClauses.push(`assigned_packer_id = $${idx++}`); params.push(updates.assignedPackerId); }
  if (updates.notes !== undefined) { setClauses.push(`notes = $${idx++}`); params.push(updates.notes); }

  params.push(id);
  const result = await pool.query(
    `UPDATE work_assignments SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

/**
 * Delete a work assignment by ID
 */
export async function deleteAssignment(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM work_assignments WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Delete all assignments for an entity
 */
export async function deleteAssignmentsForEntity(entityType: EntityType, entityId: number): Promise<number> {
  const result = await pool.query(
    'DELETE FROM work_assignments WHERE entity_type = $1 AND entity_id = $2',
    [entityType, entityId],
  );
  return result.rowCount ?? 0;
}
