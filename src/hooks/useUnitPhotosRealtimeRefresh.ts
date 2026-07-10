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
 * Refresh SERIAL_UNIT photo state for one unit when a testing-scan upload lands —
 * the unit mirror of `useReceivingPhotosRealtimeRefresh`. Two realtime paths:
 *   • `unit_photo_uploaded` on the phone bridge (mobile capture queue echo)
 *   • `unit-photo.changed` on the station channel (/api/photos/upload)
 * See docs/todo/packer-testing-photo-scan-timeline-plan.md.
 */
export function useUnitPhotosRealtimeRefresh(
  serialUnitId: number | null | undefined,
  staffId: number,
  onRefresh: () => void,
  enabled = true,
): void {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const uid = Number(serialUnitId);
  const active = enabled && Number.isFinite(uid) && uid > 0;

  const handleMessage = useCallback(
    (msg: { data?: { serial_unit_id?: number } }) => {
      const incoming = Number(msg?.data?.serial_unit_id);
      // A payload with no id (shouldn't happen) refreshes; an id must match.
      if (Number.isFinite(incoming) && incoming !== uid) return;
      onRefresh();
    },
    [uid, onRefresh],
  );

  const phoneChannel = safeChannelName(() => getPhoneBridgeChannelName(orgId!, staffId));
  useAblyChannel(
    phoneChannel,
    'unit_photo_uploaded',
    handleMessage,
    active && !!phoneChannel && staffId > 0,
  );

  const stationChannel = safeChannelName(() => getStationChannelName(orgId!));
  useAblyChannel(
    stationChannel,
    'unit-photo.changed',
    handleMessage,
    active && !!stationChannel,
  );
}
