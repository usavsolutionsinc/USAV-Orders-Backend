import type { RSRecord } from '@/lib/neon/repair-service-queries';

export interface RepairDetailsPanelProps {
  repair: RSRecord;
  /** If coming from the queue, pass the current work_assignment id (null = unassigned) */
  assignmentId?: number | null;
  /** Current assigned tech id, if any */
  assignedTechId?: number | null;
  onClose: () => void;
  onUpdate: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  disableMoveUp?: boolean;
  disableMoveDown?: boolean;
}

export type RepairTabId = 'overview' | 'links';

export const REPAIR_TABS: Array<{ value: RepairTabId; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'links', label: 'Links' },
];

export const STATUS_OPTIONS = [
  'Awaiting Parts',
  'Pending Repair',
  'Awaiting Pickup',
  'Repaired, Contact Customer',
  'Awaiting Payment',
  'Done',
];
