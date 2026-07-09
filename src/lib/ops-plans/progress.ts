import type { PlanProgress } from './types';
import type { OpsPlanTaskStatus } from './constants';

export interface TaskProgressInput {
  status: OpsPlanTaskStatus | string;
  station: string;
}

export function computePlanProgress(planId: string, tasks: TaskProgressInput[]): PlanProgress {
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === 'done').length;
  const canceledTasks = tasks.filter((t) => t.status === 'canceled').length;
  const actionable = totalTasks - canceledTasks;
  const percentComplete = actionable <= 0 ? 0 : Math.round((100 * doneTasks) / actionable);

  const byStationMap = new Map<string, { total: number; done: number }>();
  for (const task of tasks) {
    const acc = byStationMap.get(task.station) ?? { total: 0, done: 0 };
    acc.total += 1;
    if (task.status === 'done') acc.done += 1;
    byStationMap.set(task.station, acc);
  }

  const byStation = [...byStationMap.entries()]
    .map(([station, v]) => ({
      station,
      total: v.total,
      done: v.done,
      percentComplete: v.total <= 0 ? 0 : Math.round((100 * v.done) / v.total),
    }))
    .sort((a, b) => a.station.localeCompare(b.station));

  return {
    planId,
    totalTasks,
    doneTasks,
    canceledTasks,
    percentComplete,
    byStation,
  };
}

export function computePhaseProgress(tasks: Array<{ status: string }>): {
  total: number;
  done: number;
  percentComplete: number;
} {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  return {
    total,
    done,
    percentComplete: total <= 0 ? 0 : Math.round((100 * done) / total),
  };
}

export function parsePlanProgressJson(raw: unknown, planId: string): PlanProgress {
  if (!raw || typeof raw !== 'object') {
    return computePlanProgress(planId, []);
  }
  const o = raw as Record<string, unknown>;
  return {
    planId: String(o.planId ?? planId),
    totalTasks: Number(o.totalTasks ?? 0),
    doneTasks: Number(o.doneTasks ?? 0),
    canceledTasks: Number(o.canceledTasks ?? 0),
    percentComplete: Number(o.percentComplete ?? 0),
    byStation: Array.isArray(o.byStation)
      ? (o.byStation as Array<Record<string, unknown>>).map((s) => ({
          station: String(s.station ?? ''),
          total: Number(s.total ?? 0),
          done: Number(s.done ?? 0),
          percentComplete: Number(s.percentComplete ?? 0),
        }))
      : [],
  };
}
