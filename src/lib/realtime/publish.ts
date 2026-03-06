import Ably from 'ably';
import {
  getAiAssistSessionChannelName,
  getOrdersChannelName,
  getRepairsChannelName,
} from '@/lib/realtime/channels';

type OrderChangedPayload = {
  orderIds: number[];
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

let ablyRestClient: Ably.Rest | null = null;

function getAblyRestClient() {
  const key = process.env.ABLY_API_KEY;
  if (!key) return null;

  if (!ablyRestClient) {
    ablyRestClient = new Ably.Rest({ key });
  }
  return ablyRestClient;
}

async function publishEvent(channel: string, name: string, data: Record<string, unknown>) {
  const client = getAblyRestClient();
  if (!client) return;

  try {
    await client.channels.get(channel).publish(name, data);
  } catch (error) {
    console.error(`[realtime] Failed to publish "${name}" on "${channel}":`, error);
  }
}

export async function publishOrderChanged(payload: OrderChangedPayload) {
  const normalizedIds = payload.orderIds.map(Number).filter((id) => Number.isFinite(id));
  if (normalizedIds.length === 0) return;

  await publishEvent(getOrdersChannelName(), 'order.changed', {
    type: 'order.changed',
    orderIds: normalizedIds,
    source: payload.source,
    timestamp: new Date().toISOString(),
  });
}

export async function publishRepairChanged(payload: RepairChangedPayload) {
  const normalizedIds = payload.repairIds.map(Number).filter((id) => Number.isFinite(id));
  if (normalizedIds.length === 0) return;

  await publishEvent(getRepairsChannelName(), 'repair.changed', {
    type: 'repair.changed',
    repairIds: normalizedIds,
    source: payload.source,
    timestamp: new Date().toISOString(),
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
    timestamp: new Date().toISOString(),
  });
}
