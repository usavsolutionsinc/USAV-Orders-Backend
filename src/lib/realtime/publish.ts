import Ably from 'ably';
import { getValidatedAblyApiKey } from '@/lib/realtime/ably-key';
import pool from '@/lib/db';
import {
  getAiAssistSessionChannelName,
  getDashboardChannelName,
  getFbaChannelName,
  getOrdersChannelName,
  getRepairsChannelName,
  getStaffChannelName,
  getStationChannelName,
} from '@/lib/realtime/channels';
import { createStationActivityLog } from '@/lib/station-activity';
import { formatPSTTimestamp } from '@/utils/date';

type OrderChangedPayload = {
  orderIds: number[];
  source: string;
};

type OrderTestedPayload = {
  orderId: number;
  testedBy: number | null;
  source: string;
};

type RepairChangedPayload = {
  repairIds: number[];
  source: string;
};

type AiAssistantPayload = {
  channel?: string;
  sessionId: string;
  prompt: string;
  answer: string;
  model: string;
};

type TechLogChangedPayload = {
  techId: number;
  action: 'insert' | 'update' | 'delete';
  rowId?: number;
  row?: Record<string, unknown>;
  source: string;
};

type PackerLogChangedPayload = {
  packerId: number;
  action: 'insert' | 'update' | 'delete';
  packerLogId?: number;
  row?: Record<string, unknown>;
  source: string;
};

type ReceivingLogChangedPayload = {
  action: 'insert' | 'update' | 'delete';
  rowId?: string;
  row?: Record<string, unknown>;
  source: string;
};

type DashboardUpdatePayload = {
  type: 'kpi_update' | 'activity_event' | 'distribution_update' | 'staff_progress_update';
  category?: string;
  update?: any;
  data?: any;
};

type StaffScheduleChangedPayload = {
  action: 'single' | 'bulk';
  source: string;
  changed: Array<{
    staff_id: number;
    day_of_week: number;
    schedule_date?: string | null;
    is_scheduled: boolean;
  }>;
};

let ablyRestClient: Ably.Rest | null = null;

function getAblyRestClient() {
  const key = getValidatedAblyApiKey();
  if (!key) return null;

  if (!ablyRestClient) {
    ablyRestClient = new Ably.Rest({ key });
  }
  return ablyRestClient;
}

async function publishEvent(channel: string, name: string, data: Record<string, unknown>) {
  const client = getAblyRestClient();
  if (!client) return;
  const normalizedChannel = String(channel || '').trim().replace(/[\u0000-\u001F\u007F]/g, '');
  if (!normalizedChannel) return;

  try {
    await client.channels.get(normalizedChannel).publish(name, data);
    void logRealtimeEventToStationActivity(normalizedChannel, name, data);
  } catch (error) {
    console.error(`[realtime] Failed to publish "${name}" on "${normalizedChannel}":`, error);
  }
}

export async function publishDashboardUpdate(payload: DashboardUpdatePayload) {
  await publishEvent(getDashboardChannelName(), payload.type, {
    ...payload,
    timestamp: formatPSTTimestamp(),
  });
}

function parseFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function logRealtimeEventToStationActivity(
  channel: string,
  eventName: string,
  payload: Record<string, unknown>,
) {
  // Skip self-published feed events and high-churn structural updates.
  if (
    eventName === 'activity.logged'
    || eventName === 'order.changed'
    || eventName === 'order.assignments'
    || eventName === 'queue.assignments'
    || eventName === 'tech-log.changed'
    || eventName === 'packer-log.changed'
    || eventName === 'fba.shipment.changed'
    || eventName === 'fba.catalog.changed'
    || eventName === 'ai.assistant.reply'
    || eventName === 'kpi_update'
    || eventName === 'activity_event'
    || eventName === 'distribution_update'
    || eventName === 'staff_progress_update'
    || eventName === 'staff.schedule.changed'
  ) {
    return;
  }

  try {
    if (eventName === 'order.tested') {
      const orderId = parseFiniteNumber(payload.orderId);
      const staffId = parseFiniteNumber(payload.testedBy);
      const id = await createStationActivityLog(pool, {
        station: 'TECH',
        activityType: 'WS_ORDER_TESTED',
        staffId,
        scanRef: orderId != null ? String(orderId) : null,
        notes: orderId != null ? `Realtime order.tested for order ${orderId}` : 'Realtime order.tested',
        metadata: { channel, eventName, source: payload.source ?? null },
      });
      if (!id) return;
      await publishActivityLogged({
        id,
        station: 'TECH',
        activityType: 'WS_ORDER_TESTED',
        staffId,
        scanRef: orderId != null ? String(orderId) : null,
        source: String(payload.source || 'realtime.order.tested'),
      });
      return;
    }

    if (eventName === 'repair.changed') {
      const repairIds = Array.isArray(payload.repairIds)
        ? payload.repairIds.map((value) => parseFiniteNumber(value)).filter((value): value is number => value != null)
        : [];
      const id = await createStationActivityLog(pool, {
        station: 'ADMIN',
        activityType: 'WS_REPAIR_CHANGED',
        staffId: null,
        notes: repairIds.length > 0
          ? `Realtime repair.changed for repair ids: ${repairIds.join(', ')}`
          : 'Realtime repair.changed',
        metadata: { channel, eventName, source: payload.source ?? null, repairIds },
      });
      if (!id) return;
      await publishActivityLogged({
        id,
        station: 'ADMIN',
        activityType: 'WS_REPAIR_CHANGED',
        staffId: null,
        source: String(payload.source || 'realtime.repair.changed'),
      });
      return;
    }

    if (eventName === 'receiving-log.changed') {
      const rowId = payload.rowId == null ? null : String(payload.rowId);
      const action = payload.action == null ? null : String(payload.action);
      const id = await createStationActivityLog(pool, {
        station: 'RECEIVING',
        activityType: 'WS_RECEIVING_CHANGED',
        staffId: null,
        scanRef: rowId,
        notes: action ? `Realtime receiving-log.changed (${action})` : 'Realtime receiving-log.changed',
        metadata: { channel, eventName, source: payload.source ?? null, action },
      });
      if (!id) return;
      await publishActivityLogged({
        id,
        station: 'RECEIVING',
        activityType: 'WS_RECEIVING_CHANGED',
        staffId: null,
        scanRef: rowId,
        source: String(payload.source || 'realtime.receiving-log.changed'),
      });
      return;
    }

    if (eventName === 'fba.item.changed' && payload.action === 'scan') {
      const shipmentId = parseFiniteNumber(payload.shipmentId);
      const itemId = parseFiniteNumber(payload.itemId);
      const fnsku = payload.fnsku == null ? null : String(payload.fnsku);
      const id = await createStationActivityLog(pool, {
        station: 'ADMIN',
        activityType: 'WS_FBA_SCAN',
        staffId: null,
        fnsku,
        fbaShipmentId: shipmentId,
        fbaShipmentItemId: itemId,
        notes: fnsku ? `Realtime FBA scan for ${fnsku}` : 'Realtime FBA scan',
        metadata: { channel, eventName, source: payload.source ?? null },
      });
      if (!id) return;
      await publishActivityLogged({
        id,
        station: 'ADMIN',
        activityType: 'WS_FBA_SCAN',
        staffId: null,
        fnsku,
        source: String(payload.source || 'realtime.fba.item.changed'),
      });
    }
  } catch (error) {
    console.error(`[realtime] Failed to log "${eventName}" into station_activity_logs:`, error);
  }
}

export async function publishOrderChanged(payload: OrderChangedPayload) {
  const normalizedIds = payload.orderIds.map(Number).filter((id) => Number.isFinite(id));
  if (normalizedIds.length === 0) return;

  await publishEvent(getOrdersChannelName(), 'order.changed', {
    type: 'order.changed',
    orderIds: normalizedIds,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

export type OrderAssignmentsBroadcastPayload = {
  orderId: number;
  testerId: number | null;
  packerId: number | null;
  testerName: string | null;
  packerName: string | null;
  deadlineAt: string | null;
  source: string;
};

export type QueueAssignmentsBroadcastPayload = {
  entityType: string;
  entityId: number;
  source: string;
};

/** Broadcast ORDER work_assignment staff + deadline to all clients (dashboard queue, station Up Next). */
export async function publishOrderAssignmentsUpdated(payload: OrderAssignmentsBroadcastPayload) {
  const orderId = Number(payload.orderId);
  if (!Number.isFinite(orderId)) return;

  await publishEvent(getOrdersChannelName(), 'order.assignments', {
    type: 'order.assignments',
    orderId,
    testerId: payload.testerId,
    packerId: payload.packerId,
    testerName: payload.testerName,
    packerName: payload.packerName,
    deadlineAt: payload.deadlineAt,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

/** Non-order work queues (FBA, receiving, repair, SKU stock) — clients refetch Up Next. */
export async function publishQueueAssignmentsUpdated(payload: QueueAssignmentsBroadcastPayload) {
  const entityId = Number(payload.entityId);
  if (!Number.isFinite(entityId)) return;

  await publishEvent(getOrdersChannelName(), 'queue.assignments', {
    type: 'queue.assignments',
    entityType: String(payload.entityType || '').trim(),
    entityId,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

export async function publishOrderTested(payload: OrderTestedPayload) {
  const orderId = Number(payload.orderId);
  if (!Number.isFinite(orderId)) return;

  const testedByRaw = payload.testedBy == null ? null : Number(payload.testedBy);
  const testedBy = testedByRaw != null && Number.isFinite(testedByRaw) ? testedByRaw : null;
  await publishEvent(getOrdersChannelName(), 'order.tested', {
    type: 'order.tested',
    orderId,
    testedBy,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

export async function publishRepairChanged(payload: RepairChangedPayload) {
  const normalizedIds = payload.repairIds.map(Number).filter((id) => Number.isFinite(id));
  if (normalizedIds.length === 0) return;

  await publishEvent(getRepairsChannelName(), 'repair.changed', {
    type: 'repair.changed',
    repairIds: normalizedIds,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

export async function publishAiAssistantMessage(payload: AiAssistantPayload) {
  const channel = payload.channel || getAiAssistSessionChannelName(payload.sessionId);
  await publishEvent(channel, 'ai.assistant.reply', {
    type: 'ai.assistant.reply',
    sessionId: payload.sessionId,
    prompt: payload.prompt,
    answer: payload.answer,
    model: payload.model,
    timestamp: formatPSTTimestamp(),
  });
}

export async function publishStaffScheduleChanged(payload: StaffScheduleChangedPayload) {
  await publishEvent(getStaffChannelName(), 'staff.schedule.changed', {
    type: 'staff.schedule.changed',
    action: payload.action,
    source: payload.source,
    changed: payload.changed,
    timestamp: formatPSTTimestamp(),
  });
}

export async function publishTechLogChanged(payload: TechLogChangedPayload) {
  await publishEvent(getStationChannelName(), 'tech-log.changed', {
    type: 'tech-log.changed',
    techId: payload.techId,
    action: payload.action,
    rowId: payload.rowId,
    row: payload.row,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

export async function publishPackerLogChanged(payload: PackerLogChangedPayload) {
  await publishEvent(getStationChannelName(), 'packer-log.changed', {
    type: 'packer-log.changed',
    packerId: payload.packerId,
    action: payload.action,
    packerLogId: payload.packerLogId,
    row: payload.row,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

export async function publishReceivingLogChanged(payload: ReceivingLogChangedPayload) {
  await publishEvent(getStationChannelName(), 'receiving-log.changed', {
    type: 'receiving-log.changed',
    action: payload.action,
    rowId: payload.rowId,
    row: payload.row,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

// ─── FBA Events ──────────────────────────────────────────────────────────────

type FbaItemChangedPayload = {
  action: 'scan' | 'ready' | 'verify' | 'label-bind' | 'shipped' | 'reassign' | 'update' | 'delete';
  shipmentId: number;
  itemId?: number;
  fnsku?: string;
  source: string;
};

type FbaShipmentChangedPayload = {
  action: 'created' | 'updated' | 'closed' | 'deleted' | 'mark-shipped' | 'tracking-linked' | 'tracking-unlinked' | 'duplicated' | 'items-added';
  shipmentId: number;
  source: string;
};

type FbaCatalogChangedPayload = {
  action: 'created' | 'updated' | 'bulk-uploaded';
  fnsku?: string;
  count?: number;
  source: string;
};

export async function publishFbaItemChanged(payload: FbaItemChangedPayload) {
  await publishEvent(getFbaChannelName(), 'fba.item.changed', {
    type: 'fba.item.changed',
    action: payload.action,
    shipmentId: payload.shipmentId,
    itemId: payload.itemId,
    fnsku: payload.fnsku,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

export async function publishFbaShipmentChanged(payload: FbaShipmentChangedPayload) {
  await publishEvent(getFbaChannelName(), 'fba.shipment.changed', {
    type: 'fba.shipment.changed',
    action: payload.action,
    shipmentId: payload.shipmentId,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

export async function publishFbaCatalogChanged(payload: FbaCatalogChangedPayload) {
  await publishEvent(getFbaChannelName(), 'fba.catalog.changed', {
    type: 'fba.catalog.changed',
    action: payload.action,
    fnsku: payload.fnsku,
    count: payload.count,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });
}

// ─── Activity Stream ─────────────────────────────────────────────────────────

type ActivityLoggedPayload = {
  id: number;
  station: string;
  activityType: string;
  staffId: number | null;
  staffName?: string | null;
  scanRef?: string | null;
  fnsku?: string | null;
  source: string;
};

export async function publishActivityLogged(payload: ActivityLoggedPayload) {
  // Update station channel for legacy feed
  await publishEvent(getStationChannelName(), 'activity.logged', {
    type: 'activity.logged',
    id: payload.id,
    station: payload.station,
    activityType: payload.activityType,
    staffId: payload.staffId,
    staffName: payload.staffName,
    scanRef: payload.scanRef,
    fnsku: payload.fnsku,
    source: payload.source,
    timestamp: formatPSTTimestamp(),
  });

  // Update all-in-one dashboard feed
  await publishDashboardUpdate({
    type: 'activity_event',
    data: {
      id: String(payload.id),
      timestamp: formatPSTTimestamp(),
      type: payload.activityType,
      source: payload.station,
      summary: payload.scanRef || payload.fnsku || 'Activity logged',
      staff_id: payload.staffId
    }
  });
}
