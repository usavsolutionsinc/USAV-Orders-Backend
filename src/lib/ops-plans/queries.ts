import type { PoolClient } from 'pg';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { computePhaseProgress, parsePlanProgressJson } from './progress';
import {
  isValidTaskTransition,
  reconcilePhaseStatus,
  reconcilePlanStatus,
} from './transitions';
import type {
  PlanDetail,
  PlanRow,
  PhaseRow,
  PhaseWithTasks,
  TaskLinkRow,
  TaskRow,
} from './types';
import type { OpsPlanPhaseStatus, OpsPlanStatus, OpsPlanTaskStatus } from './constants';
import { getPlanTemplate } from './templates';

function toIso(v: unknown): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function toDateOnly(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

async function fetchPlanProgress(orgId: OrgId, planId: string) {
  const r = await tenantQuery(orgId,
    `SELECT ops_plan_progress($1::uuid, $2::uuid) AS progress`,
    [planId, orgId],
  );
  return parsePlanProgressJson(r.rows[0]?.progress, planId);
}

async function verifyStaffInOrg(client: PoolClient, orgId: OrgId, staffId: number): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM staff WHERE id = $1 AND organization_id = $2::uuid AND COALESCE(active, true) = true LIMIT 1`,
    [staffId, orgId],
  );
  return (r.rowCount ?? 0) > 0;
}

async function reconcilePhase(client: PoolClient, orgId: OrgId, phaseId: string): Promise<void> {
  const tasks = await client.query<{ status: OpsPlanTaskStatus }>(
    `SELECT status::text AS status FROM ops_plan_tasks
      WHERE phase_id = $1::uuid AND organization_id = $2::uuid`,
    [phaseId, orgId],
  );
  const next = reconcilePhaseStatus(tasks.rows.map((r) => r.status));
  await client.query(
    `UPDATE ops_plan_phases SET status = $3::ops_plan_phase_status, updated_at = now()
      WHERE id = $1::uuid AND organization_id = $2::uuid`,
    [phaseId, orgId, next],
  );
}

async function reconcilePlan(client: PoolClient, orgId: OrgId, planId: string): Promise<void> {
  const phases = await client.query<{ status: OpsPlanPhaseStatus }>(
    `SELECT status::text AS status FROM ops_plan_phases
      WHERE plan_id = $1::uuid AND organization_id = $2::uuid`,
    [planId, orgId],
  );
  const plan = await client.query<{ status: OpsPlanStatus }>(
    `SELECT status::text AS status FROM ops_plans WHERE id = $1::uuid AND organization_id = $2::uuid`,
    [planId, orgId],
  );
  const current = plan.rows[0]?.status ?? 'draft';
  const next = reconcilePlanStatus(phases.rows.map((r) => r.status), current);
  if (next !== current && next === 'done') {
    await client.query(
      `UPDATE ops_plans SET status = 'done'::ops_plan_status, updated_at = now()
        WHERE id = $1::uuid AND organization_id = $2::uuid`,
      [planId, orgId],
    );
  }
}

function mapTaskRow(row: Record<string, unknown>): TaskRow {
  return {
    id: String(row.id),
    phaseId: String(row.phase_id),
    planId: String(row.plan_id),
    planTitle: String(row.plan_title ?? ''),
    station: String(row.station ?? ''),
    title: String(row.title),
    assigneeStaffId: row.assignee_staff_id == null ? null : Number(row.assignee_staff_id),
    assigneeName: row.assignee_name ? String(row.assignee_name) : null,
    status: String(row.status) as OpsPlanTaskStatus,
    dueAt: toIso(row.due_at),
    startedAt: toIso(row.started_at),
    completedAt: toIso(row.completed_at),
    completedByStaffId: row.completed_by_staff_id == null ? null : Number(row.completed_by_staff_id),
    notes: row.notes ? String(row.notes) : null,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: toIso(row.created_at) ?? '',
    updatedAt: toIso(row.updated_at) ?? '',
  };
}

export async function listPlans(
  orgId: OrgId,
  opts: { status?: string | null; q?: string | null } = {},
): Promise<{ plans: PlanRow[]; total: number }> {
  const params: unknown[] = [orgId];
  const clauses = ['p.organization_id = $1::uuid', 'p.archived_at IS NULL'];
  if (opts.status) {
    params.push(opts.status);
    clauses.push(`p.status = $${params.length}::ops_plan_status`);
  }
  if (opts.q?.trim()) {
    params.push(`%${opts.q.trim()}%`);
    clauses.push(`(p.title ILIKE $${params.length} OR COALESCE(p.description, '') ILIKE $${params.length})`);
  }
  const where = clauses.join(' AND ');
  const result = await tenantQuery(orgId,
    `SELECT p.id, p.title, p.description, p.status::text AS status, p.target_date,
            p.created_by_staff_id, s.name AS created_by_name,
            p.archived_at, p.created_at, p.updated_at
       FROM ops_plans p
       LEFT JOIN staff s ON s.id = p.created_by_staff_id
      WHERE ${where}
      ORDER BY p.updated_at DESC, p.id`,
    params,
  );
  const plans: PlanRow[] = [];
  for (const row of result.rows) {
    const planId = String(row.id);
    const progress = await fetchPlanProgress(orgId, planId);
    plans.push({
      id: planId,
      title: String(row.title),
      description: row.description ? String(row.description) : null,
      status: String(row.status) as OpsPlanStatus,
      targetDate: toDateOnly(row.target_date),
      createdByStaffId: row.created_by_staff_id == null ? null : Number(row.created_by_staff_id),
      createdByName: row.created_by_name ? String(row.created_by_name) : null,
      archivedAt: toIso(row.archived_at),
      createdAt: toIso(row.created_at) ?? '',
      updatedAt: toIso(row.updated_at) ?? '',
      progress,
    });
  }
  return { plans, total: plans.length };
}

export async function getPlanDetail(orgId: OrgId, planId: string): Promise<PlanDetail | null> {
  const planResult = await tenantQuery(orgId,
    `SELECT p.id, p.title, p.description, p.status::text AS status, p.target_date,
            p.created_by_staff_id, s.name AS created_by_name,
            p.archived_at, p.created_at, p.updated_at
       FROM ops_plans p
       LEFT JOIN staff s ON s.id = p.created_by_staff_id
      WHERE p.id = $1::uuid AND p.organization_id = $2::uuid`,
    [planId, orgId],
  );
  if (planResult.rows.length === 0) return null;
  const row = planResult.rows[0];
  const progress = await fetchPlanProgress(orgId, planId);
  const plan: PlanRow = {
    id: planId,
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    status: String(row.status) as OpsPlanStatus,
    targetDate: toDateOnly(row.target_date),
    createdByStaffId: row.created_by_staff_id == null ? null : Number(row.created_by_staff_id),
    createdByName: row.created_by_name ? String(row.created_by_name) : null,
    archivedAt: toIso(row.archived_at),
    createdAt: toIso(row.created_at) ?? '',
    updatedAt: toIso(row.updated_at) ?? '',
    progress,
  };

  const phasesResult = await tenantQuery(orgId,
    `SELECT id, plan_id, station, title, description, sort_order, status::text AS status,
            created_at, updated_at
       FROM ops_plan_phases
      WHERE plan_id = $1::uuid AND organization_id = $2::uuid
      ORDER BY sort_order ASC, created_at ASC`,
    [planId, orgId],
  );

  const tasksResult = await tenantQuery(orgId,
    `SELECT t.id, t.phase_id, p.plan_id, pl.title AS plan_title, p.station,
            t.title, t.assignee_staff_id, st.name AS assignee_name,
            t.status::text AS status, t.due_at, t.started_at, t.completed_at,
            t.completed_by_staff_id, t.notes, t.sort_order, t.created_at, t.updated_at
       FROM ops_plan_tasks t
       JOIN ops_plan_phases p ON p.id = t.phase_id AND p.organization_id = t.organization_id
       JOIN ops_plans pl ON pl.id = p.plan_id AND pl.organization_id = p.organization_id
       LEFT JOIN staff st ON st.id = t.assignee_staff_id
      WHERE p.plan_id = $1::uuid AND t.organization_id = $2::uuid
      ORDER BY p.sort_order ASC, t.sort_order ASC, t.created_at ASC`,
    [planId, orgId],
  );

  const tasksByPhase = new Map<string, TaskRow[]>();
  for (const t of tasksResult.rows) {
    const task = mapTaskRow(t);
    const arr = tasksByPhase.get(task.phaseId) ?? [];
    arr.push(task);
    tasksByPhase.set(task.phaseId, arr);
  }

  const phases: PhaseWithTasks[] = phasesResult.rows.map((p) => {
    const phaseId = String(p.id);
    const tasks = tasksByPhase.get(phaseId) ?? [];
    return {
      id: phaseId,
      planId: String(p.plan_id),
      station: String(p.station),
      title: String(p.title),
      description: p.description ? String(p.description) : null,
      sortOrder: Number(p.sort_order ?? 0),
      status: String(p.status) as OpsPlanPhaseStatus,
      createdAt: toIso(p.created_at) ?? '',
      updatedAt: toIso(p.updated_at) ?? '',
      progress: computePhaseProgress(tasks),
      tasks,
    };
  });

  return { plan, phases };
}

export async function createPlan(
  orgId: OrgId,
  input: {
    title: string;
    description?: string | null;
    targetDate?: string | null;
    createdByStaffId?: number | null;
  },
): Promise<{ plan: PlanRow }> {
  return withTenantTransaction(orgId, async (client) => {
    const inserted = await client.query(
      `INSERT INTO ops_plans (organization_id, title, description, target_date, created_by_staff_id, status)
       VALUES ($1::uuid, $2, $3, $4::date, $5, 'draft'::ops_plan_status)
       RETURNING id`,
      [orgId, input.title, input.description ?? null, input.targetDate ?? null, input.createdByStaffId ?? null],
    );
    const planId = String(inserted.rows[0].id);
    const detail = await getPlanDetail(orgId, planId);
    if (!detail) throw new Error('PLAN_NOT_FOUND');
    return { plan: detail.plan };
  });
}

export async function createPlanFromTemplate(
  orgId: OrgId,
  templateKey: string,
  overrides: { title?: string; createdByStaffId?: number | null },
): Promise<PlanDetail | null> {
  const template = getPlanTemplate(templateKey);
  if (!template) return null;

  return withTenantTransaction(orgId, async (client) => {
    const planInsert = await client.query(
      `INSERT INTO ops_plans (organization_id, title, description, created_by_staff_id, status)
       VALUES ($1::uuid, $2, $3, $4, 'draft'::ops_plan_status)
       RETURNING id`,
      [orgId, overrides.title ?? template.title, template.description, overrides.createdByStaffId ?? null],
    );
    const planId = String(planInsert.rows[0].id);
    let phaseOrder = 100;
    for (const phase of template.phases) {
      const phaseInsert = await client.query(
        `INSERT INTO ops_plan_phases (organization_id, plan_id, station, title, sort_order)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5)
         RETURNING id`,
        [orgId, planId, phase.station, phase.title, phaseOrder],
      );
      const phaseId = String(phaseInsert.rows[0].id);
      let taskOrder = 100;
      for (const taskTitle of phase.tasks) {
        await client.query(
          `INSERT INTO ops_plan_tasks (organization_id, phase_id, title, sort_order)
           VALUES ($1::uuid, $2::uuid, $3, $4)`,
          [orgId, phaseId, taskTitle, taskOrder],
        );
        taskOrder += 100;
      }
      phaseOrder += 100;
    }
    return getPlanDetail(orgId, planId);
  });
}

export async function updatePlan(
  orgId: OrgId,
  planId: string,
  patch: {
    title?: string;
    description?: string | null;
    targetDate?: string | null;
    status?: OpsPlanStatus;
  },
): Promise<PlanRow | null> {
  if (patch.status === 'active') {
    const check = await tenantQuery(orgId,
      `SELECT COUNT(*)::int AS cnt
         FROM ops_plan_phases p
         JOIN ops_plan_tasks t ON t.phase_id = p.id AND t.organization_id = p.organization_id
        WHERE p.plan_id = $1::uuid AND p.organization_id = $2::uuid`,
      [planId, orgId],
    );
    if (Number(check.rows[0]?.cnt ?? 0) < 1) {
      throw new Error('PLAN_ACTIVATE_REQUIRES_TASKS');
    }
  }

  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [planId, orgId];
  if (patch.title != null) {
    params.push(patch.title);
    sets.push(`title = $${params.length}`);
  }
  if (patch.description !== undefined) {
    params.push(patch.description);
    sets.push(`description = $${params.length}`);
  }
  if (patch.targetDate !== undefined) {
    params.push(patch.targetDate);
    sets.push(`target_date = $${params.length}::date`);
  }
  if (patch.status != null) {
    params.push(patch.status);
    sets.push(`status = $${params.length}::ops_plan_status`);
    if (patch.status === 'archived') {
      sets.push('archived_at = now()');
    }
  }

  const result = await tenantQuery(orgId,
    `UPDATE ops_plans SET ${sets.join(', ')}
      WHERE id = $1::uuid AND organization_id = $2::uuid
      RETURNING id`,
    params,
  );
  if (result.rowCount === 0) return null;
  const detail = await getPlanDetail(orgId, planId);
  return detail?.plan ?? null;
}

export async function archivePlan(orgId: OrgId, planId: string): Promise<boolean> {
  const result = await tenantQuery(orgId,
    `UPDATE ops_plans
        SET status = 'archived'::ops_plan_status, archived_at = now(), updated_at = now()
      WHERE id = $1::uuid AND organization_id = $2::uuid`,
    [planId, orgId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function createPhase(
  orgId: OrgId,
  planId: string,
  input: { station: string; title: string; description?: string | null; sortOrder?: number },
): Promise<PhaseRow | null> {
  const plan = await tenantQuery(orgId,
    `SELECT id FROM ops_plans WHERE id = $1::uuid AND organization_id = $2::uuid`,
    [planId, orgId],
  );
  if (plan.rows.length === 0) return null;

  let sortOrder = input.sortOrder;
  if (sortOrder == null) {
    const max = await tenantQuery(orgId,
      `SELECT COALESCE(MAX(sort_order), 0) + 100 AS next_order
         FROM ops_plan_phases WHERE plan_id = $1::uuid AND organization_id = $2::uuid`,
      [planId, orgId],
    );
    sortOrder = Number(max.rows[0]?.next_order ?? 100);
  }

  const result = await tenantQuery(orgId,
    `INSERT INTO ops_plan_phases (organization_id, plan_id, station, title, description, sort_order)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
     RETURNING id, plan_id, station, title, description, sort_order, status::text AS status, created_at, updated_at`,
    [orgId, planId, input.station, input.title, input.description ?? null, sortOrder],
  );
  const row = result.rows[0];
  return {
    id: String(row.id),
    planId: String(row.plan_id),
    station: String(row.station),
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    sortOrder: Number(row.sort_order),
    status: String(row.status) as OpsPlanPhaseStatus,
    createdAt: toIso(row.created_at) ?? '',
    updatedAt: toIso(row.updated_at) ?? '',
  };
}

export async function updatePhase(
  orgId: OrgId,
  phaseId: string,
  patch: { title?: string; description?: string | null; sortOrder?: number; station?: string },
): Promise<PhaseRow | null> {
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [phaseId, orgId];
  if (patch.title != null) {
    params.push(patch.title);
    sets.push(`title = $${params.length}`);
  }
  if (patch.description !== undefined) {
    params.push(patch.description);
    sets.push(`description = $${params.length}`);
  }
  if (patch.sortOrder != null) {
    params.push(patch.sortOrder);
    sets.push(`sort_order = $${params.length}`);
  }
  if (patch.station != null) {
    params.push(patch.station);
    sets.push(`station = $${params.length}`);
  }
  const result = await tenantQuery(orgId,
    `UPDATE ops_plan_phases SET ${sets.join(', ')}
      WHERE id = $1::uuid AND organization_id = $2::uuid
      RETURNING id, plan_id, station, title, description, sort_order, status::text AS status, created_at, updated_at`,
    params,
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: String(row.id),
    planId: String(row.plan_id),
    station: String(row.station),
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    sortOrder: Number(row.sort_order),
    status: String(row.status) as OpsPlanPhaseStatus,
    createdAt: toIso(row.created_at) ?? '',
    updatedAt: toIso(row.updated_at) ?? '',
  };
}

export async function deletePhase(orgId: OrgId, phaseId: string): Promise<boolean> {
  const result = await tenantQuery(orgId,
    `DELETE FROM ops_plan_phases WHERE id = $1::uuid AND organization_id = $2::uuid`,
    [phaseId, orgId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function createTask(
  orgId: OrgId,
  phaseId: string,
  input: {
    title: string;
    assigneeStaffId?: number | null;
    dueAt?: string | null;
    notes?: string | null;
    sortOrder?: number;
    clientEventId?: string | null;
  },
): Promise<{ task: TaskRow; planId: string; idempotent?: boolean } | null> {
  return withTenantTransaction(orgId, async (client) => {
    if (input.clientEventId) {
      const existing = await client.query(
        `SELECT t.id, p.plan_id
           FROM ops_plan_tasks t
           JOIN ops_plan_phases p ON p.id = t.phase_id
          WHERE t.organization_id = $1::uuid AND t.client_event_id = $2
          LIMIT 1`,
        [orgId, input.clientEventId],
      );
      if (existing.rows[0]) {
        const tasks = await listTasksForInbox(orgId, { planId: String(existing.rows[0].plan_id) });
        const task = tasks.find((t) => t.id === String(existing.rows[0].id));
        if (task) {
          return { task, planId: String(existing.rows[0].plan_id), idempotent: true };
        }
      }
    }

    const phase = await client.query(
      `SELECT plan_id FROM ops_plan_phases WHERE id = $1::uuid AND organization_id = $2::uuid`,
      [phaseId, orgId],
    );
    if (phase.rows.length === 0) return null;
    const planId = String(phase.rows[0].plan_id);

    if (input.assigneeStaffId != null) {
      const ok = await verifyStaffInOrg(client, orgId, input.assigneeStaffId);
      if (!ok) throw new Error('INVALID_ASSIGNEE');
    }

    let sortOrder = input.sortOrder;
    if (sortOrder == null) {
      const max = await client.query(
        `SELECT COALESCE(MAX(sort_order), 0) + 100 AS next_order
           FROM ops_plan_tasks WHERE phase_id = $1::uuid AND organization_id = $2::uuid`,
        [phaseId, orgId],
      );
      sortOrder = Number(max.rows[0]?.next_order ?? 100);
    }

    const status: OpsPlanTaskStatus = input.assigneeStaffId != null ? 'in_progress' : 'open';
    const inserted = await client.query(
      `INSERT INTO ops_plan_tasks (
         organization_id, phase_id, title, assignee_staff_id, status,
         due_at, notes, sort_order, client_event_id, started_at
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4,
         $5::ops_plan_task_status,
         $6::timestamptz, $7, $8, $9,
         CASE WHEN $5::text = 'in_progress' THEN now() ELSE NULL END
       )
       RETURNING id`,
      [
        orgId, phaseId, input.title, input.assigneeStaffId ?? null,
        status, input.dueAt ?? null, input.notes ?? null, sortOrder, input.clientEventId ?? null,
      ],
    );
    const taskId = String(inserted.rows[0].id);
    await reconcilePhase(client, orgId, phaseId);
    await reconcilePlan(client, orgId, planId);

    const tasks = await listTasksForInbox(orgId, { planId });
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new Error('TASK_NOT_FOUND');
    return { task, planId };
  });
}

export async function updateTask(
  orgId: OrgId,
  taskId: string,
  patch: {
    title?: string;
    assigneeStaffId?: number | null;
    status?: OpsPlanTaskStatus;
    dueAt?: string | null;
    notes?: string | null;
    actorStaffId?: number;
    forceComplete?: boolean;
  },
): Promise<{ task: TaskRow; planId: string } | null> {
  return withTenantTransaction(orgId, async (client) => {
    const current = await client.query(
      `SELECT t.id, t.status::text AS status, t.phase_id, p.plan_id
         FROM ops_plan_tasks t
         JOIN ops_plan_phases p ON p.id = t.phase_id
        WHERE t.id = $1::uuid AND t.organization_id = $2::uuid`,
      [taskId, orgId],
    );
    if (current.rows.length === 0) return null;
    const row = current.rows[0];
    const phaseId = String(row.phase_id);
    const planId = String(row.plan_id);
    const fromStatus = String(row.status) as OpsPlanTaskStatus;
    let toStatus = patch.status ?? fromStatus;

    if (patch.assigneeStaffId != null) {
      const ok = await verifyStaffInOrg(client, orgId, patch.assigneeStaffId);
      if (!ok) throw new Error('INVALID_ASSIGNEE');
      if (fromStatus === 'open' && !patch.status) toStatus = 'in_progress';
    }

    if (!isValidTaskTransition(fromStatus, toStatus)) {
      throw new Error('INVALID_TRANSITION');
    }

    const sets: string[] = ['updated_at = now()'];
    const params: unknown[] = [taskId, orgId];
    if (patch.title != null) {
      params.push(patch.title);
      sets.push(`title = $${params.length}`);
    }
    if (patch.assigneeStaffId !== undefined) {
      params.push(patch.assigneeStaffId);
      sets.push(`assignee_staff_id = $${params.length}`);
    }
    if (patch.dueAt !== undefined) {
      params.push(patch.dueAt);
      sets.push(`due_at = $${params.length}::timestamptz`);
    }
    if (patch.notes !== undefined) {
      params.push(patch.notes);
      sets.push(`notes = $${params.length}`);
    }
    if (toStatus !== fromStatus || patch.status) {
      params.push(toStatus);
      sets.push(`status = $${params.length}::ops_plan_task_status`);
      if (toStatus === 'in_progress' && fromStatus === 'open') {
        sets.push('started_at = COALESCE(started_at, now())');
      }
      if (toStatus === 'done') {
        sets.push('completed_at = now()');
        if (patch.actorStaffId != null) {
          params.push(patch.actorStaffId);
          sets.push(`completed_by_staff_id = $${params.length}`);
        }
      }
    }

    await client.query(
      `UPDATE ops_plan_tasks SET ${sets.join(', ')}
        WHERE id = $1::uuid AND organization_id = $2::uuid`,
      params,
    );
    await reconcilePhase(client, orgId, phaseId);
    await reconcilePlan(client, orgId, planId);

    const tasks = await listTasksForInbox(orgId, { planId });
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new Error('TASK_NOT_FOUND');
    return { task, planId };
  });
}

export async function claimTask(
  orgId: OrgId,
  taskId: string,
  staffId: number,
): Promise<{ task: TaskRow; planId: string } | null> {
  const current = await tenantQuery(orgId,
    `SELECT assignee_staff_id, status::text AS status FROM ops_plan_tasks
      WHERE id = $1::uuid AND organization_id = $2::uuid`,
    [taskId, orgId],
  );
  if (current.rows.length === 0) return null;
  if (current.rows[0].assignee_staff_id != null) throw new Error('ALREADY_ASSIGNED');
  return updateTask(orgId, taskId, {
    assigneeStaffId: staffId,
    status: 'in_progress',
    actorStaffId: staffId,
  });
}

export async function completeTask(
  orgId: OrgId,
  taskId: string,
  actorStaffId: number,
  opts: { isManager?: boolean } = {},
): Promise<{ task: TaskRow; planId: string } | null> {
  const current = await tenantQuery(orgId,
    `SELECT assignee_staff_id, status::text AS status FROM ops_plan_tasks
      WHERE id = $1::uuid AND organization_id = $2::uuid`,
    [taskId, orgId],
  );
  if (current.rows.length === 0) return null;
  const assignee = current.rows[0].assignee_staff_id == null ? null : Number(current.rows[0].assignee_staff_id);
  if (!opts.isManager && assignee != null && assignee !== actorStaffId) {
    throw new Error('NOT_ASSIGNEE');
  }
  return updateTask(orgId, taskId, {
    status: 'done',
    actorStaffId,
    assigneeStaffId: assignee ?? actorStaffId,
  });
}

export async function listTasksForInbox(
  orgId: OrgId,
  filters: { planId?: string | null; staffId?: number | null; station?: string | null; status?: 'open' | 'all' } = {},
): Promise<TaskRow[]> {
  const params: unknown[] = [orgId];
  const clauses = ['t.organization_id = $1::uuid'];
  if (filters.planId) {
    params.push(filters.planId);
    clauses.push(`p.plan_id = $${params.length}::uuid`);
  }
  if (filters.staffId != null) {
    params.push(filters.staffId);
    clauses.push(`t.assignee_staff_id = $${params.length}`);
  }
  if (filters.station) {
    params.push(filters.station);
    clauses.push(`p.station = $${params.length}`);
  }
  if (filters.status !== 'all') {
    clauses.push(`t.status IN ('open'::ops_plan_task_status, 'in_progress'::ops_plan_task_status)`);
  }
  const where = clauses.join(' AND ');
  const result = await tenantQuery(orgId,
    `SELECT t.id, t.phase_id, p.plan_id, pl.title AS plan_title, p.station,
            t.title, t.assignee_staff_id, st.name AS assignee_name,
            t.status::text AS status, t.due_at, t.started_at, t.completed_at,
            t.completed_by_staff_id, t.notes, t.sort_order, t.created_at, t.updated_at
       FROM ops_plan_tasks t
       JOIN ops_plan_phases p ON p.id = t.phase_id AND p.organization_id = t.organization_id
       JOIN ops_plans pl ON pl.id = p.plan_id AND pl.organization_id = p.organization_id
       LEFT JOIN staff st ON st.id = t.assignee_staff_id
      WHERE ${where}
      ORDER BY t.due_at ASC NULLS LAST, t.created_at ASC`,
    params,
  );
  return result.rows.map(mapTaskRow);
}

export async function getTaskContext(
  orgId: OrgId,
  taskId: string,
): Promise<{ task: TaskRow; planId: string; phaseId: string } | null> {
  const result = await tenantQuery(orgId,
    `SELECT t.id, t.phase_id, p.plan_id, pl.title AS plan_title, p.station,
            t.title, t.assignee_staff_id, st.name AS assignee_name,
            t.status::text AS status, t.due_at, t.started_at, t.completed_at,
            t.completed_by_staff_id, t.notes, t.sort_order, t.created_at, t.updated_at
       FROM ops_plan_tasks t
       JOIN ops_plan_phases p ON p.id = t.phase_id AND p.organization_id = t.organization_id
       JOIN ops_plans pl ON pl.id = p.plan_id AND pl.organization_id = p.organization_id
       LEFT JOIN staff st ON st.id = t.assignee_staff_id
      WHERE t.id = $1::uuid AND t.organization_id = $2::uuid`,
    [taskId, orgId],
  );
  if (result.rows.length === 0) return null;
  const task = mapTaskRow(result.rows[0]);
  return { task, planId: task.planId, phaseId: task.phaseId };
}
