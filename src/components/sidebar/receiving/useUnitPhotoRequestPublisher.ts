'use client';

/**
 * Publishes a `unit_photo_request` on `staffstation:{staffId}` so a phone loaded
 * on the same staff id auto-navigates to the SERIAL_UNIT photo capture page — the
 * packer testing-label scan → phone camera hand-off
 * (docs/todo/packer-testing-photo-scan-timeline-plan.md).
 *
 * This is the exact mirror of `usePhotoRequestPublisher` (receiving), but in a
 * fully separate namespace: the event is `unit_photo_request` (vs
 * `receiving_photo_request`) and the payload is unit-scoped. It reuses the same
 * per-staff `staffstation:` channel — implicit pairing, no claim flow.
 */

import { useCallback } from 'react';
import { safeRandomUUID } from '@/lib/safe-uuid';
import type { useAblyClient } from '@/contexts/AblyContext';

type AblyGetClient = ReturnType<typeof useAblyClient>['getClient'];

interface UseUnitPhotoRequestPublisherArgs {
  staffIdNum: number;
  getAblyClient: AblyGetClient;
  /** `staffstation:{staffId}` channel name (`''` when org/staff unresolved). */
  stationChannelName: string;
}

export type UnitPhotoRequestPublisher = (args: {
  /** Canonical serial_units.id — the phone uses it as the upload entityId. */
  serialUnitId: number;
  /** Resolvable unit key (serial or minted unit_uid) for display + poRef filing. */
  unitKey: string | null;
}) => Promise<void>;

export function useUnitPhotoRequestPublisher({
  staffIdNum,
  getAblyClient,
  stationChannelName,
}: UseUnitPhotoRequestPublisherArgs): UnitPhotoRequestPublisher {
  return useCallback(
    async ({ serialUnitId, unitKey }) => {
      if (!Number.isFinite(serialUnitId) || serialUnitId <= 0 || staffIdNum <= 0) return;
      if (!stationChannelName) return;
      try {
        const client = await getAblyClient();
        if (!client) return;
        const ch = client.channels.get(stationChannelName);
        await ch.publish('unit_photo_request', {
          serial_unit_id: serialUnitId,
          unit_key: unitKey,
          request_id: safeRandomUUID(),
          requested_by_staff_id: staffIdNum,
        });
      } catch (err) {
        console.warn('station-testing: unit photo request publish failed', err);
      }
    },
    [getAblyClient, staffIdNum, stationChannelName],
  );
}
