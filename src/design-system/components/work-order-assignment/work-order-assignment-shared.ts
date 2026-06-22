import { getOrderPlatformLabel, getOrderSourceTag } from '@/utils/order-platform';
import { toDateInputValue, type WorkOrderRow, type WorkStatus } from '@/components/work-orders/types';

export interface StaffOption {
  id: number;
  name: string;
}

export interface AssignmentStaffContext {
  techniciansOn?: StaffOption[];
  techniciansOff?: StaffOption[];
  techniciansInactive?: StaffOption[];
  packersOn?: StaffOption[];
  packersOff?: StaffOption[];
  packersInactive?: StaffOption[];
}

export interface AssignmentDraft {
  techId: number | null;
  packerId: number | null;
  deadline: string;
}

export interface AssignmentConfirmPayload {
  techId: number | null;
  packerId: number | null;
  deadline: string | null;
  status?: WorkStatus;
}

export interface WorkOrderAssignmentCardProps {
  rows: WorkOrderRow[];
  startIndex: number;
  technicianOptions: StaffOption[];
  packerOptions: StaffOption[];
  onConfirm: (row: WorkOrderRow, payload: AssignmentConfirmPayload) => void;
  onClose: () => void;
  storageKey?: string;
  allowEditConfirmed?: boolean;
  closeWhenCompleted?: boolean;
  staffContext?: AssignmentStaffContext;
}

/** Plain text only (no chips): e.g. “Orders · Amazon”, “FBA”, or queue label. */
export function assignmentHeaderContextText(row: WorkOrderRow): string {
  if (row.entityType === 'ORDER') {
    const orderKey = row.orderId ?? row.recordLabel;
    const channel = getOrderSourceTag(orderKey, row.accountSource);
    const platform = getOrderPlatformLabel(row.recordLabel, row.accountSource).trim();
    if (!platform) return channel || row.queueLabel;
    if (platform.toLowerCase() === channel.toLowerCase()) return channel;
    return `${channel} · ${platform}`;
  }
  return row.queueLabel;
}

export function toDraft(row: WorkOrderRow): AssignmentDraft {
  return {
    techId: row.techId ?? null,
    packerId: row.packerId ?? null,
    deadline: toDateInputValue(row.deadlineAt ?? null),
  };
}

export function isDraftComplete(row: WorkOrderRow, draft: AssignmentDraft): boolean {
  if (row.entityType === 'SKU_STOCK') return draft.techId != null;
  return draft.techId != null && draft.packerId != null;
}

export function isRowNeedingAssignment(row: WorkOrderRow): boolean {
  if (row.status === 'DONE' || row.status === 'CANCELED') return false;
  if (row.entityType === 'SKU_STOCK') return row.techId == null;
  return row.techId == null || row.packerId == null;
}

export function isRowUnassigned(row: WorkOrderRow): boolean {
  if (row.entityType === 'SKU_STOCK') return row.techId == null;
  return row.techId == null && row.packerId == null;
}

export function toTimestamp(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const stamp = new Date(value).getTime();
  return Number.isFinite(stamp) ? stamp : Number.NEGATIVE_INFINITY;
}

export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function toRowDateKey(value: string | null | undefined): string | null {
  const stamp = toTimestamp(value);
  if (!Number.isFinite(stamp)) return null;
  return toLocalDateKey(new Date(stamp));
}

export function compareRowsByUpdatedAtDesc(a: WorkOrderRow, b: WorkOrderRow): number {
  const updatedDiff = toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt);
  if (updatedDiff !== 0) return updatedDiff;

  const createdDiff = toTimestamp(b.createdAt ?? null) - toTimestamp(a.createdAt ?? null);
  if (createdDiff !== 0) return createdDiff;

  return b.entityId - a.entityId;
}
