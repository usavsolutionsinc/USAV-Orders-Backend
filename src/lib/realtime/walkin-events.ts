import Ably from 'ably';
import { getValidatedAblyApiKey } from '@/lib/realtime/ably-key';
import { getWalkInChannelName } from '@/lib/realtime/channels';

let ablyRestClient: Ably.Rest | null = null;

function getAblyRestClient() {
  const key = getValidatedAblyApiKey();
  if (!key) return null;
  if (!ablyRestClient) {
    ablyRestClient = new Ably.Rest({ key });
  }
  return ablyRestClient;
}

export async function publishSaleCompleted(payload: {
  squareOrderId: string;
  source: string;
}) {
  const client = getAblyRestClient();
  if (!client) return;

  const channel = getWalkInChannelName();
  try {
    await client.channels.get(channel).publish('sale.completed', {
      squareOrderId: payload.squareOrderId,
      source: payload.source,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[realtime] Failed to publish sale.completed:', error);
  }
}
