import Ably from 'ably';
import { getValidatedAblyApiKey } from '@/lib/realtime/ably-key';
import {
  getAiAssistSessionChannelName,
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
