'use client';

import { useCallback, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import {
  getPhoneBridgeChannelName,
  getStationChannelName,
  safeChannelName,
} from '@/lib/realtime/channels';
import type { ReceivingPhotoChangedPayload } from '@/utils/events';

/**
 * Invalidate receiving photo queries when uploads land via either realtime path:
 *   • `receiving_photo_uploaded` on the phone bridge (mobile capture queue)
 *   • `receiving-photo.changed` on the station channel (NAS attach, /api/photos/upload)
 *   • `receiving-photo.changed` window event (same-tab PhotoViewerModal / library delete)
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

  const matchesScope = useCallback(
    (incomingReceivingId: number | null | undefined) => {
      if (incomingReceivingId == null || !Number.isFinite(incomingReceivingId)) {
        // Broad delete (photo library) — no receiving id in the payload; refresh.
        return true;
      }
      return incomingReceivingId === rid;
    },
    [rid],
  );

  const handleMessage = useCallback(
    (msg: { data?: { receiving_id?: number } }) => {
      const incoming = Number(msg?.data?.receiving_id);
      if (!matchesScope(Number.isFinite(incoming) ? incoming : null)) return;
      onRefresh();
    },
    [matchesScope, onRefresh],
  );

  useEffect(() => {
    if (!active) return;
    const onWindowEvent = (e: Event) => {
      const detail = (e as CustomEvent<ReceivingPhotoChangedPayload>).detail;
      if (!matchesScope(detail?.receivingId ?? null)) return;
      onRefresh();
    };
    window.addEventListener('receiving-photo.changed', onWindowEvent);
    return () => window.removeEventListener('receiving-photo.changed', onWindowEvent);
  }, [active, matchesScope, onRefresh]);

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
