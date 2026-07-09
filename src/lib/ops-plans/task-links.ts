import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { updateTask } from './queries';
import type { TaskLinkRow } from './types';
import type { OpsPlanTaskLinkType } from './constants';

function mapLinkRow(row: Record<string, unknown>): TaskLinkRow {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    linkType: String(row.link_type),
    linkEntityType: row.link_entity_type ? String(row.link_entity_type) : null,
    linkEntityId: String(row.link_entity_id),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export async function createTaskLink(
  orgId: OrgId,
  taskId: string,
  input: {
    linkType: OpsPlanTaskLinkType;
    linkEntityType?: string | null;
    linkEntityId: string;
  },
): Promise<TaskLinkRow | null> {
  const task = await tenantQuery(orgId,
    `SELECT id FROM ops_plan_tasks WHERE id = $1::uuid AND organization_id = $2::uuid`,
    [taskId, orgId],
  );
  if (task.rows.length === 0) return null;

  const result = await tenantQuery(orgId,
    `INSERT INTO ops_plan_task_links (
       organization_id, task_id, link_type, link_entity_type, link_entity_id
     ) VALUES ($1::uuid, $2::uuid, $3, $4, $5)
     ON CONFLICT ON CONSTRAINT ops_plan_task_links_unique DO NOTHING
     RETURNING id, task_id, link_type, link_entity_type, link_entity_id, created_at`,
    [orgId, taskId, input.linkType, input.linkEntityType ?? null, input.linkEntityId],
  );
  if (result.rows.length === 0) {
    const existing = await tenantQuery(orgId,
      `SELECT id, task_id, link_type, link_entity_type, link_entity_id, created_at
         FROM ops_plan_task_links
        WHERE task_id = $1::uuid AND organization_id = $2::uuid
          AND link_type = $3 AND link_entity_type IS NOT DISTINCT FROM $4
          AND link_entity_id = $5`,
      [taskId, orgId, input.linkType, input.linkEntityType ?? null, input.linkEntityId],
    );
    if (existing.rows.length === 0) return null;
    return mapLinkRow(existing.rows[0]);
  }
  return mapLinkRow(result.rows[0]);
}

export async function deleteTaskLink(orgId: OrgId, linkId: string): Promise<boolean> {
  const result = await tenantQuery(orgId,
    `DELETE FROM ops_plan_task_links WHERE id = $1::uuid AND organization_id = $2::uuid`,
    [linkId, orgId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * When a linked work_assignment moves to IN_PROGRESS, promote the plan task.
 * Called from work-order PATCH via after() — default manual complete on DONE.
 */
export async function syncLinkProgressFromWorkAssignment(
  orgId: OrgId,
  workAssignmentId: number,
  workStatus: string,
): Promise<void> {
  const links = await tenantQuery(orgId,
    `SELECT l.task_id, t.status::text AS task_status
       FROM ops_plan_task_links l
       JOIN ops_plan_tasks t ON t.id = l.task_id AND t.organization_id = l.organization_id
      WHERE l.organization_id = $1::uuid
        AND l.link_type = 'work_assignment'
        AND l.link_entity_id = $2`,
    [orgId, String(workAssignmentId)],
  );
  for (const row of links.rows) {
    const taskId = String(row.task_id);
    const taskStatus = String(row.task_status);
    if (workStatus === 'IN_PROGRESS' && taskStatus === 'open') {
      await updateTask(orgId, taskId, { status: 'in_progress' });
    }
  }
}
