'use client';

import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import {
  getPhoneBridgeChannelName,
  getStationChannelName,
  safeChannelName,
} from '@/lib/realtime/channels';

/**
 * Invalidate receiving photo queries when uploads land via either realtime path:
 *   • `receiving_photo_uploaded` on the phone bridge (mobile capture queue)
 *   • `receiving-photo.changed` on the station channel (NAS attach, /api/photos/upload)
 */
export function useReceivingPhotosRealtimeRefresh(
  receivingId: number | null | undefined,
  staffId: number,
  onRefresh: () => void,
  enabled = true,
): void {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const rid = Number(receivingId);
  const active = enabled && Number.isFinite(rid) && rid > 0;

  const handleMessage = useCallback(
    (msg: { data?: { receiving_id?: number } }) => {
      const incoming = Number(msg?.data?.receiving_id);
      if (!Number.isFinite(incoming) || incoming !== rid) return;
      onRefresh();
    },
    [rid, onRefresh],
  );

  const phoneChannel = safeChannelName(() => getPhoneBridgeChannelName(orgId!, staffId));
  useAblyChannel(
    phoneChannel,
    'receiving_photo_uploaded',
    handleMessage,
    active && !!phoneChannel && staffId > 0,
  );

  const stationChannel = safeChannelName(() => getStationChannelName(orgId!));
  useAblyChannel(
    stationChannel,
    'receiving-photo.changed',
    handleMessage,
    active && !!stationChannel,
  );
}
