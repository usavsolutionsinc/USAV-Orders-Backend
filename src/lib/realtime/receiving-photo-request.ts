import { getStaffStationBridgeChannelName, safeChannelName } from './channels';
import { safeRandomUUID } from '@/lib/safe-uuid';

export interface ReceivingPhotoRequestClient {
  channels: {
    get: (name: string) => {
      publish: (event: string, data: Record<string, unknown>) => Promise<void>;
    };
  };
}

export function getReceivingPhotoRequestChannelName(orgId: string | null | undefined, staffId: number): string {
  if (!orgId || staffId <= 0) return '';
  return safeChannelName(() => getStaffStationBridgeChannelName(orgId, staffId));
}

function makeRequestId(): string {
  return safeRandomUUID();
}

export async function publishReceivingPhotoRequest(
  client: ReceivingPhotoRequestClient | null,
  orgId: string | null | undefined,
  staffId: number,
  receivingId: number,
): Promise<void> {
  const channelName = getReceivingPhotoRequestChannelName(orgId, staffId);
  if (!client || !channelName || !Number.isFinite(receivingId) || receivingId <= 0) return;
  const channel = client.channels.get(channelName);
  await channel.publish('receiving_photo_request', {
    receiving_id: receivingId,
    request_id: makeRequestId(),
    requested_by_staff_id: staffId,
  });
}
