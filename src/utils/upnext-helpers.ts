import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import type { WorkOrderRow } from '@/components/work-orders/types';
import type { Order, RepairQueueItem, FBAQueueItem } from '@/components/station/upnext/upnext-types';

// ─── Display helpers ────────────────────────────────────────────────────────

export function getOrderIdLast4(orderId: string) {
  const digits = String(orderId || '').replace(/\D/g, '');
  if (digits.length >= 4) return digits.slice(-4);
  return String(orderId || '').slice(-4);
}

export function getLast4(value: string | null | undefined) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length >= 4) return digits.slice(-4);
  const raw = String(value || '').trim();
  return raw.length > 4 ? raw.slice(-4) : raw || 'None';
}

export function getTrackingLast4(tracking: string) {
  const digits = String(tracking || '').replace(/\D/g, '');
  if (digits.length >= 4) return digits.slice(-4);
  return String(tracking || '').slice(-4);
}

// ─── Date / urgency helpers ─────────────────────────────────────────────────

export function getDisplayShipByDate(order: { ship_by_date?: string | null; created_at?: string | null }) {
  const shipByRaw = String(order.ship_by_date || '').trim();
  const createdAtRaw = String(order.created_at || '').trim();
  const isInvalid = !shipByRaw || /^\d+$/.test(shipByRaw) || Number.isNaN(new Date(shipByRaw).getTime());
  return isInvalid ? createdAtRaw || null : shipByRaw;
}

export function getDaysLateNumber(shipByDate: string | null | undefined, fallbackDate?: string | null) {
  const shipByKey = toPSTDateKey(shipByDate) || toPSTDateKey(fallbackDate);
  const todayKey  = getCurrentPSTDateKey();
  if (!shipByKey || !todayKey) return 0;
  const [sy, sm, sd] = shipByKey.split('-').map(Number);
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const shipByIndex = Math.floor(Date.UTC(sy, sm - 1, sd) / 86400000);
  const todayIndex  = Math.floor(Date.UTC(ty, tm - 1, td) / 86400000);
  return Math.max(0, todayIndex - shipByIndex);
}

export function getDaysLateTone(daysLate: number) {
  if (daysLate > 1) return 'text-red-600';
  if (daysLate === 1) return 'text-yellow-600';
  return 'text-emerald-600';
}

// ─── Condition helpers ──────────────────────────────────────────────────────

export function getConditionColor(condition: string | null | undefined) {
  const c = (condition || '').toLowerCase().trim();
  if (c.includes('new')) return 'text-yellow-500';
  if (c.includes('part')) return 'text-amber-800';
  return 'text-black';
}

export function stripConditionPrefix(title: string | null | undefined, condition: string | null | undefined) {
  const t = (title || '').trimStart();
  const c = (condition || '').trim();
  if (!t || !c) return t;
  if (t.toLowerCase().startsWith(c.toLowerCase())) {
    return t.slice(c.length).trimStart();
  }
  return t;
}

// ─── WorkOrderRow builders ──────────────────────────────────────────────────

export function buildOrderWorkOrderRow(order: Order): WorkOrderRow {
  return {
    id:          `order-${order.id}`,
    entityType:  'ORDER',
    entityId:    order.id,
    queueKey:    'orders',
    queueLabel:  'Orders',
    title:       order.product_title || 'Unknown Product',
    subtitle:    [order.order_id, order.shipping_tracking_number, order.sku].filter(Boolean).join(' • '),
    recordLabel: order.order_id || '',
    sourcePath:  '/work-orders',
    techId:      order.tester_id ?? null,
    techName:    order.tester_name ?? null,
    packerId:    order.packer_id ?? null,
    packerName:  order.packer_name ?? null,
    status:      'OPEN',
    priority:    0,
    deadlineAt:  order.ship_by_date ?? null,
    notes:       null,
    assignedAt:  null,
    updatedAt:   null,
    orderId:     order.order_id || null,
    trackingNumber: order.shipping_tracking_number || null,
  };
}

export function buildRepairWorkOrderRow(repair: RepairQueueItem): WorkOrderRow {
  return {
    id:           `repair-${repair.repairId}`,
    entityType:   'REPAIR',
    entityId:     repair.repairId,
    queueKey:     'repair_services',
    queueLabel:   'Repair Services',
    title:        repair.productTitle || 'Unknown Product',
    subtitle:     repair.ticketNumber || '',
    recordLabel:  repair.ticketNumber || '',
    sourcePath:   '/work-orders',
    techId:       repair.assignedTechId,
    techName:     repair.techName,
    packerId:     null,
    packerName:   null,
    status:       (repair.assignmentStatus as WorkOrderRow['status']) || 'OPEN',
    priority:     0,
    deadlineAt:   repair.deadlineAt,
    notes:        repair.issue || null,
    assignedAt:   null,
    updatedAt:    null,
  };
}

export function buildFbaWorkOrderRow(item: FBAQueueItem): WorkOrderRow {
  return {
    id: `fba-shipment-${item.shipment_id}`,
    entityType: 'FBA_SHIPMENT',
    entityId: item.shipment_id,
    queueKey: 'fba_shipments',
    queueLabel: 'FBA Shipments',
    title: String(item.plan_title || item.shipment_ref || `Pending shipment #${item.shipment_id}`),
    subtitle: [item.fnsku, item.asin, item.sku].filter(Boolean).join(' • '),
    recordLabel: String(item.shipment_ref || `Row #${item.shipment_id}`),
    sourcePath: '/fba',
    techId: item.assigned_tech_id ?? null,
    techName: item.assigned_tech_name ?? null,
    packerId: item.assigned_packer_id ?? null,
    packerName: null,
    status: item.assigned_tech_id ? 'ASSIGNED' : 'OPEN',
    priority: 100,
    deadlineAt: String(item.deadline_at || item.due_date || '').trim() || null,
    notes: null,
    assignedAt: null,
    updatedAt: null,
  };
}
