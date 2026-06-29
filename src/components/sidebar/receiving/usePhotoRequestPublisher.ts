'use client';

/**
 * Publishes a `receiving_photo_request` on `staffstation:{staffId}` so a phone
 * loaded on the same staff id auto-navigates to the photo capture page.
 *
 * Implicit pairing: the channel name is the gate — no claim flow required.
 * Extracted from ReceivingSidebarPanel; the scan flow calls the returned
 * publisher after a matched/unmatched carton resolves.
 */

import { useCallback } from 'react';
import { randomId } from '@/components/sidebar/receiving/receiving-sidebar-shared';
import type { useAblyClient } from '@/contexts/AblyContext';

type AblyGetClient = ReturnType<typeof useAblyClient>['getClient'];

interface UsePhotoRequestPublisherArgs {
  staffIdNum: number;
  getAblyClient: AblyGetClient;
  /** `staffstation:{staffId}` channel name (`''` when org/staff unresolved). */
  stationChannelName: string;
}

export type PhotoRequestPublisher = (
  receivingId: number,
  tracking: string,
) => Promise<void>;

export function usePhotoRequestPublisher({
  staffIdNum,
  getAblyClient,
  stationChannelName,
}: UsePhotoRequestPublisherArgs): PhotoRequestPublisher {
  return useCallback(
    async (receivingId: number, tracking: string) => {
      if (!Number.isFinite(receivingId) || receivingId <= 0 || staffIdNum <= 0) return;
      if (!stationChannelName) return;
      try {
        const client = await getAblyClient();
        if (!client) return;
        const ch = client.channels.get(stationChannelName);
        await ch.publish('receiving_photo_request', {
          receiving_id: receivingId,
          tracking,
          request_id: randomId(),
          requested_by_staff_id: staffIdNum,
        });
      } catch (err) {
        console.warn('receiving-sidebar: photo request publish failed', err);
      }
    },
    [getAblyClient, staffIdNum, stationChannelName],
  );
}
