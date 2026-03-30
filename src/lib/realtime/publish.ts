import Ably from 'ably';
import { getValidatedAblyApiKey } from '@/lib/realtime/ably-key';
import {
  getAiAssistSessionChannelName,
  getFbaChannelName,
  getOrdersChannelName,
  getRepairsChannelName,
  getStationChannelName,
} from '@/lib/realtime/channels';
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
  } catch (error) {
    console.error(`[realtime] Failed to publish "${name}" on "${normalizedChannel}":`, error);
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
}
