export type QueueKey =
  | 'all'
  | 'all_unassigned'
  | 'all_assigned'
  | 'orders'
  | 'test_returns'
  | 'fba_shipments'
  | 'repair_services'
  | 'test_receiving'
  | 'local_pickups'
  | 'stock_replenish';

export type WorkStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';
export type EntityType = 'ORDER' | 'REPAIR' | 'FBA_SHIPMENT' | 'RECEIVING' | 'SKU_STOCK';

export interface WorkOrderRow {
  id: string;
  entityType: EntityType;
  entityId: number;
  queueKey: Exclude<QueueKey, 'all' | 'all_unassigned' | 'all_assigned'>;
  queueLabel: string;
  title: string;
  subtitle: string;
  recordLabel: string;
  sourcePath: string;
  techId: number | null;
  techName: string | null;
  packerId: number | null;
  packerName: string | null;
  status: WorkStatus;
  priority: number;
  deadlineAt: string | null;
  notes: string | null;
  assignedAt: string | null;
  updatedAt: string | null;
  stockLevel?: number | null;
}

export interface QueueCounts {
  all: number;
  all_unassigned: number;
  all_assigned: number;
  orders: number;
  test_returns: number;
  fba_shipments: number;
  repair_services: number;
  test_receiving: number;
  local_pickups: number;
  stock_replenish: number;
}

export const EMPTY_COUNTS: QueueCounts = {
  all: 0,
  all_unassigned: 0,
  all_assigned: 0,
  orders: 0,
  test_returns: 0,
  fba_shipments: 0,
  repair_services: 0,
  test_receiving: 0,
  local_pickups: 0,
  stock_replenish: 0,
};

export const STATUS_OPTIONS: WorkStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'CANCELED'];

export const STATUS_COLOR: Record<WorkStatus, string> = {
  OPEN: 'text-slate-600 bg-slate-100',
  ASSIGNED: 'text-blue-700 bg-blue-50',
  IN_PROGRESS: 'text-amber-700 bg-amber-50',
  DONE: 'text-emerald-700 bg-emerald-50',
  CANCELED: 'text-red-600 bg-red-50',
};

export const QUEUE_ITEMS: Array<{ key: QueueKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'all_unassigned', label: 'Unassigned' },
  { key: 'all_assigned', label: 'Assigned' },
  { key: 'orders', label: 'Orders' },
  { key: 'test_returns', label: 'Test Returns' },
  { key: 'fba_shipments', label: 'FBA Shipments' },
  { key: 'repair_services', label: 'Repair Services' },
  { key: 'test_receiving', label: 'Test Receiving' },
  { key: 'local_pickups', label: 'Local Pick-ups' },
  { key: 'stock_replenish', label: 'Stock Replenish' },
];

export function normalizeQueue(raw: string | null): QueueKey {
  const value = String(raw || '').trim().toLowerCase();
  return (QUEUE_ITEMS.find((item) => item.key === value)?.key || 'all') as QueueKey;
}

export function formatDate(value: string | null) {
  if (!value) return 'No deadline';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No deadline';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function toDateInputValue(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export function buildSourceHref(row: WorkOrderRow) {
  const params = new URLSearchParams();
  if (row.entityType === 'ORDER') params.set('pending', '');
  return row.sourcePath + (params.toString() ? `?${params.toString()}` : '');
}
