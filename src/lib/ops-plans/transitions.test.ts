import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidTaskTransition,
  reconcilePhaseStatus,
  reconcilePlanStatus,
  planTaskStatusRank,
} from './transitions';
import { computePlanProgress, computePhaseProgress } from './progress';
import {
  filterInboxItems,
  mergePlanTasksAndWorkOrders,
  paginateInboxItems,
  planTaskToInboxItem,
} from './inbox';
import type { TaskRow } from './types';
import type { WorkOrderRow } from '@/components/work-orders/types';

function task(partial: Partial<TaskRow> & Pick<TaskRow, 'id' | 'title' | 'status'>): TaskRow {
  return {
    phaseId: 'phase-1',
    planId: 'plan-1',
    planTitle: 'Plan',
    station: 'TECH',
    assigneeStaffId: null,
    assigneeName: null,
    dueAt: null,
    startedAt: null,
    completedAt: null,
    completedByStaffId: null,
    notes: null,
    sortOrder: 0,
    createdAt: '2026-07-08T12:00:00.000Z',
    updatedAt: '2026-07-08T12:00:00.000Z',
    ...partial,
  };
}

test('transitions: valid open → in_progress and done', () => {
  assert.equal(isValidTaskTransition('open', 'in_progress'), true);
  assert.equal(isValidTaskTransition('in_progress', 'done'), true);
  assert.equal(isValidTaskTransition('done', 'open'), false);
});

test('reconcilePhaseStatus: all done → phase done', () => {
  assert.equal(reconcilePhaseStatus(['done', 'done']), 'done');
  assert.equal(reconcilePhaseStatus(['open', 'in_progress']), 'in_progress');
});

test('reconcilePlanStatus: manual paused preserved', () => {
  assert.equal(reconcilePlanStatus(['done'], 'paused'), 'paused');
});

test('planTaskStatusRank: in_progress most urgent', () => {
  assert.ok(planTaskStatusRank('in_progress') < planTaskStatusRank('open'));
});

test('computePlanProgress: canceled excluded from denominator', () => {
  const p = computePlanProgress('plan-1', [
    { status: 'done', station: 'TECH' },
    { status: 'canceled', station: 'TECH' },
    { status: 'open', station: 'RECEIVING' },
  ]);
  assert.equal(p.totalTasks, 3);
  assert.equal(p.doneTasks, 1);
  assert.equal(p.canceledTasks, 1);
  assert.equal(p.percentComplete, 50);
});

test('computePhaseProgress: empty', () => {
  const p = computePhaseProgress([]);
  assert.equal(p.percentComplete, 0);
});

test('inbox: merge ranks in_progress plan task before open work order', () => {
  const planTasks = [task({ id: 't1', title: 'Count bins', status: 'in_progress' })];
  const workOrders: WorkOrderRow[] = [{
    id: 'ORDER:1',
    entityType: 'ORDER',
    entityId: 1,
    queueKey: 'orders',
    queueLabel: 'Orders',
    title: 'Order 1',
    subtitle: '',
    recordLabel: '1',
    sourcePath: '/dashboard',
    techId: 1,
    techName: 'A',
    packerId: null,
    packerName: null,
    status: 'OPEN',
    priority: 100,
    deadlineAt: null,
    notes: null,
    assignedAt: null,
    updatedAt: null,
    primaryWorkType: 'TEST',
  }];
  const merged = mergePlanTasksAndWorkOrders(planTasks, workOrders, Date.parse('2026-07-08T12:00:00.000Z'));
  assert.equal(merged[0]?.source, 'plan_task');
});

test('inbox: staff filter', () => {
  const items = [
    planTaskToInboxItem(task({ id: 't1', title: 'A', status: 'open', assigneeStaffId: 5 })),
    planTaskToInboxItem(task({ id: 't2', title: 'B', status: 'open', assigneeStaffId: 9 })),
  ];
  const filtered = filterInboxItems(items, { staffId: 5, source: 'all', status: 'open' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.assigneeStaffId, 5);
});

test('inbox: pagination cursor', () => {
  const items = [
    planTaskToInboxItem(task({ id: 'a', title: 'A', status: 'open' })),
    planTaskToInboxItem(task({ id: 'b', title: 'B', status: 'open' })),
    planTaskToInboxItem(task({ id: 'c', title: 'C', status: 'open' })),
  ];
  const page1 = paginateInboxItems(items, 2, null);
  assert.equal(page1.items.length, 2);
  assert.equal(page1.nextCursor, 'b');
  const page2 = paginateInboxItems(items, 2, page1.nextCursor);
  assert.equal(page2.items.length, 1);
  assert.equal(page2.nextCursor, null);
});
