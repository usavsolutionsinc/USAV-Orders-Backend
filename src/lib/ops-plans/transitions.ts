import type { OpsPlanPhaseStatus, OpsPlanTaskStatus } from './constants';

export function isValidTaskTransition(from: OpsPlanTaskStatus, to: OpsPlanTaskStatus): boolean {
  if (from === to) return true;
  if (to === 'canceled') return from === 'open' || from === 'in_progress';
  if (from === 'open' && to === 'in_progress') return true;
  if (from === 'open' && to === 'done') return true;
  if (from === 'in_progress' && to === 'done') return true;
  if (from === 'in_progress' && to === 'open') return true;
  return false;
}

export function reconcilePhaseStatus(taskStatuses: OpsPlanTaskStatus[]): OpsPlanPhaseStatus {
  if (taskStatuses.length === 0) return 'open';
  const actionable = taskStatuses.filter((s) => s !== 'canceled');
  if (actionable.length === 0) return 'canceled';
  if (actionable.every((s) => s === 'done')) return 'done';
  if (actionable.some((s) => s === 'in_progress' || s === 'done')) return 'in_progress';
  return 'open';
}

export function reconcilePlanStatus(
  phaseStatuses: OpsPlanPhaseStatus[],
  current: string,
): 'draft' | 'active' | 'paused' | 'done' | 'archived' {
  if (current === 'archived' || current === 'paused' || current === 'draft') {
    return current as 'draft' | 'active' | 'paused' | 'done' | 'archived';
  }
  const actionable = phaseStatuses.filter((s) => s !== 'canceled');
  if (actionable.length > 0 && actionable.every((s) => s === 'done')) return 'done';
  return current === 'draft' ? 'draft' : 'active';
}

export function planTaskStatusRank(status: OpsPlanTaskStatus): number {
  if (status === 'in_progress') return 0;
  if (status === 'open') return 1;
  if (status === 'done') return 2;
  return 3;
}
