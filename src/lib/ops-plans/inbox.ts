import type { WorkOrderRow } from '@/components/work-orders/types';
import { compareWorkOrderRows } from '@/lib/work-orders/ranking';
import { QUEUE_KEY_TO_STATION } from './constants';
import type { InboxItem, TaskRow } from './types';
import { planTaskStatusRank } from './transitions';

function planTaskUrgencyScore(task: TaskRow, nowMs: number): number {
  const statusScore = planTaskStatusRank(task.status) * 1_000_000;
  const dueMs = task.dueAt ? new Date(task.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const dueScore = Math.max(0, dueMs - nowMs);
  const createdMs = task.createdAt ? new Date(task.createdAt).getTime() : 0;
  return statusScore + dueScore / 1000 + createdMs / 1_000_000_000;
}

function workOrderUrgencyScore(row: WorkOrderRow, nowMs: number): number {
  const statusRank = row.status === 'IN_PROGRESS' ? 0 : row.status === 'ASSIGNED' ? 1 : row.status === 'OPEN' ? 2 : 3;
  const dueMs = row.deadlineAt ? new Date(row.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;
  const dueScore = Math.max(0, dueMs - nowMs);
  return statusRank * 1_000_000 + row.priority * 1000 + dueScore / 1000;
}

export function planTaskToInboxItem(task: TaskRow, nowMs = Date.now()): InboxItem {
  const rank = planTaskUrgencyScore(task, nowMs);
  return {
    source: 'plan_task',
    id: task.id,
    title: task.title,
    subtitle: [task.planTitle, task.station].filter(Boolean).join(' · '),
    status: task.status,
    assigneeStaffId: task.assigneeStaffId,
    assigneeName: task.assigneeName,
    station: task.station,
    dueAt: task.dueAt,
    priority: 100,
    planId: task.planId,
    planTitle: task.planTitle,
    sourcePath: `/operations?mode=plan&planId=${task.planId}`,
    rank,
  };
}

export function workOrderToInboxItem(row: WorkOrderRow, nowMs = Date.now()): InboxItem {
  const assigneeStaffId = row.techId ?? row.packerId;
  const assigneeName = row.techName ?? row.packerName;
  const rank = workOrderUrgencyScore(row, nowMs);
  return {
    source: 'work_assignment',
    id: `wa:${row.id}`,
    title: row.title,
    subtitle: row.subtitle || row.queueLabel,
    status: row.status,
    assigneeStaffId,
    assigneeName,
    station: QUEUE_KEY_TO_STATION[row.queueKey] ?? null,
    dueAt: row.deadlineAt,
    priority: row.priority,
    queueKey: row.queueKey,
    sourcePath: row.sourcePath,
    rank,
  };
}

export function mergePlanTasksAndWorkOrders(
  planTasks: TaskRow[],
  workOrders: WorkOrderRow[],
  nowMs = Date.now(),
): InboxItem[] {
  const items = [
    ...planTasks.map((t) => planTaskToInboxItem(t, nowMs)),
    ...workOrders.map((w) => workOrderToInboxItem(w, nowMs)),
  ];
  return items.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.id.localeCompare(b.id);
  });
}

export function filterInboxItems(
  items: InboxItem[],
  filters: {
    staffId?: number | null;
    station?: string | null;
    source?: 'plan' | 'operational' | 'all';
    status?: 'open' | 'all';
    q?: string;
    planId?: string | null;
  },
): InboxItem[] {
  const q = (filters.q ?? '').trim().toLowerCase();
  return items.filter((item) => {
    if (filters.planId && item.planId !== filters.planId) return false;
    if (filters.staffId != null && item.assigneeStaffId !== filters.staffId) return false;
    if (filters.station && item.station !== filters.station) return false;
    if (filters.source === 'plan' && item.source !== 'plan_task') return false;
    if (filters.source === 'operational' && item.source !== 'work_assignment') return false;
    if (filters.status === 'open') {
      const openish = item.status === 'open' || item.status === 'OPEN'
        || item.status === 'in_progress' || item.status === 'IN_PROGRESS'
        || item.status === 'ASSIGNED';
      if (!openish) return false;
    }
    if (q) {
      const hay = [item.title, item.subtitle, item.planTitle, item.assigneeName].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function paginateInboxItems(
  items: InboxItem[],
  limit: number,
  cursor: string | null,
): { items: InboxItem[]; nextCursor: string | null } {
  let start = 0;
  if (cursor) {
    const idx = items.findIndex((i) => i.id === cursor);
    start = idx >= 0 ? idx + 1 : 0;
  }
  const slice = items.slice(start, start + limit);
  const nextCursor = start + limit < items.length ? slice[slice.length - 1]?.id ?? null : null;
  return { items: slice, nextCursor };
}

/** Stable compare for work orders only — exported for tests. */
export { compareWorkOrderRows };
