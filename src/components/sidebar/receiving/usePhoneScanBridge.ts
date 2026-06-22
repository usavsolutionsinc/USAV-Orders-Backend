'use client';

/**
 * Phone-paired scan bridge. Incoming `phone_scan` messages on `phone:{staffId}`
 * route straight through the same `submitTrackingScan` flow as a desktop
 * scanner; the result is echoed back on `station:{staffId}` as
 * `phone_scan_result` so the phone's UI can render matched/unmatched without a
 * round-trip DB query. Extracted from ReceivingSidebarPanel; behaviour is
 * unchanged.
 */

import { useAblyChannel } from '@/hooks/useAblyChannel';
import type { useAblyClient } from '@/contexts/AblyContext';
import type { TrackingScanState } from '@/components/sidebar/receiving/useTrackingScan';

type AblyGetClient = ReturnType<typeof useAblyClient>['getClient'];

interface UsePhoneScanBridgeArgs {
  phoneChannelName: string;
  stationChannelName: string;
  getAblyClient: AblyGetClient;
  staffId: string;
  submitTrackingScan: TrackingScanState['submitTrackingScan'];
}

export function usePhoneScanBridge({
  phoneChannelName,
  stationChannelName,
  getAblyClient,
  staffId,
  submitTrackingScan,
}: UsePhoneScanBridgeArgs): void {
  useAblyChannel(
    phoneChannelName,
    'phone_scan',
    (msg: { data?: { tracking?: string } }) => {
      const tracking = String(msg?.data?.tracking || '').trim();
      if (!tracking) return;
      submitTrackingScan(tracking, {
        onResult: async (result) => {
          try {
            if (!stationChannelName) return;
            const client = await getAblyClient();
            if (!client) return;
            const ch = client.channels.get(stationChannelName);
            await ch.publish('phone_scan_result', {
              tracking: result.tracking,
              matched: result.matched,
              po_ids: result.po_ids,
              receiving_id: result.receiving_id ?? null,
              exception_id: result.exception_id ?? null,
              exception_reason: result.exception_reason ?? null,
              error: result.error ?? null,
            });
          } catch (err) {
            console.warn('phone_scan_result publish failed', err);
          }
        },
      });
    },
    !!phoneChannelName && Number(staffId) > 0,
  );
}
