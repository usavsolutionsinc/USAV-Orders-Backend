import type {
  OpsPlanPhaseStatus,
  OpsPlanStatus,
  OpsPlanTaskStatus,
  InboxItemSource,
} from './constants';

export interface PlanProgress {
  planId: string;
  totalTasks: number;
  doneTasks: number;
  canceledTasks: number;
  percentComplete: number;
  byStation: Array<{
    station: string;
    total: number;
    done: number;
    percentComplete: number;
  }>;
}

export interface PlanRow {
  id: string;
  title: string;
  description: string | null;
  status: OpsPlanStatus;
  targetDate: string | null;
  createdByStaffId: number | null;
  createdByName: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  progress: PlanProgress;
}

export interface PhaseRow {
  id: string;
  planId: string;
  station: string;
  title: string;
  description: string | null;
  sortOrder: number;
  status: OpsPlanPhaseStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRow {
  id: string;
  phaseId: string;
  planId: string;
  planTitle: string;
  station: string;
  title: string;
  assigneeStaffId: number | null;
  assigneeName: string | null;
  status: OpsPlanTaskStatus;
  dueAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  completedByStaffId: number | null;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PhaseWithTasks extends PhaseRow {
  progress: { total: number; done: number; percentComplete: number };
  tasks: TaskRow[];
}

export interface PlanDetail {
  plan: PlanRow;
  phases: PhaseWithTasks[];
}

export interface InboxItem {
  source: InboxItemSource;
  id: string;
  title: string;
  subtitle: string;
  status: string;
  assigneeStaffId: number | null;
  assigneeName: string | null;
  station: string | null;
  dueAt: string | null;
  priority: number;
  planId?: string;
  planTitle?: string;
  queueKey?: string;
  sourcePath?: string;
  rank: number;
}

export interface TaskLinkRow {
  id: string;
  taskId: string;
  linkType: string;
  linkEntityType: string | null;
  linkEntityId: string;
  createdAt: string;
}
