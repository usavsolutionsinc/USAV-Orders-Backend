'use client';

import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import {
  safeChannelName,
  getPhoneBridgeChannelName,
  getStaffStationBridgeChannelName,
} from '@/lib/realtime/channels';
import { useRealtimeToasts } from '@/hooks/useRealtimeToasts';
import { MobileReceivingRow } from '@/components/mobile/receiving/MobileReceivingRow';
import { MobileCartonSheet } from '@/components/mobile/receiving/MobileCartonSheet';
import { MobileFeed } from '@/components/mobile/feed/MobileFeed';
import { useFeedWindow, useMobileFeedQuery } from '@/components/mobile/feed/useMobileFeed';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

interface ApiResponse {
  success: boolean;
  receiving_lines: ReceivingLineRow[];
}

// Same query key + fetch as the desktop ReceivingRecentRail (the "Unboxing"
// rail) so the mobile feed shares its cache and shows the exact same lines.
const QUERY_KEY = ['receiving-lines-table', 'rail', 'activity', 'receive', 'unboxed_newest'] as const;

/**
 * Mobile receiving surface — single scrollable list of receiving lines, newest
 * pinned at the bottom in an expanded card, older rows as compact pills. Tap a
 * row to open MobileCartonSheet; the expanded card's camera CTA jumps to the
 * capture route.
 *
 * Display logic (windowing, bottom-anchored scroll, fresh-row pulse, realtime
 * refetch) now lives in the shared {@link useMobileFeedQuery}/{@link useFeedWindow}
 * + {@link MobileFeed} primitives so every mobile feed behaves identically.
 *
 * `limit` controls how many recent rows render — default 8 (one phone screen);
 * the dedicated /receiving page passes a larger value.
 */
export function MobileReceivingList({ limit = 8 }: { limit?: number } = {}) {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const staffId = user?.staffId ?? 0;
  const stationBridgeChannel = safeChannelName(() => getStaffStationBridgeChannelName(orgId!, staffId));
  const phoneChannel = safeChannelName(() => getPhoneBridgeChannelName(orgId!, staffId));
  useRealtimeToasts('receiving');

  const { data, isLoading, refetch } = useMobileFeedQuery<ReceivingLineRow>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      // Mirror ReceivingRecentRail: the UNBOXING pipeline (view=activity), with
      // serials, so both surfaces render the same rows.
      const params = new URLSearchParams({
        limit: '500',
        offset: '0',
        view: 'activity',
        include: 'serials',
        // MUST match ReceivingRecentRail — same react-query key; without this
        // the default server sort is scanned_newest and refetches scramble order.
        sort: 'unboxed_newest',
      });
      const res = await fetch(`/api/receiving-lines?${params.toString()}`);
      if (!res.ok) throw new Error('fetch failed');
      const json = (await res.json()) as ApiResponse;
      return Array.isArray(json.receiving_lines) ? json.receiving_lines : [];
    },
    realtime: {
      invalidation: { receiving: true },
      // Desktop tracking scan publishes here → surface the new carton instantly.
      ably: {
        channel: stationBridgeChannel,
        event: 'receiving_photo_request',
        enabled: !!stationBridgeChannel && staffId > 0,
      },
      windowEvents: ['usav-refresh-data'],
    },
  });

  // A finished photo upload (camera or background queue) publishes here for the
  // same staff — refetch so each row's `photo_count` (the Take Photos button's
  // `x{n}` badge) ticks up. Ably echoes to the publisher, so this fires on the
  // capturing phone too, not just a paired one.
  useAblyChannel(
    phoneChannel,
    'receiving_photo_uploaded',
    refetch,
    !!phoneChannel && staffId > 0,
  );

  const { rows, scrollRef, freshIds } = useFeedWindow(data, { limit, anchor: 'bottom' });

  const [sheetRow, setSheetRow] = useState<ReceivingLineRow | null>(null);
  // Re-derive the open sheet's row from the live feed so its CTA photo count
  // updates after an upload — the stored `sheetRow` snapshot would stay stale.
  const liveSheetRow = useMemo(
    () => (sheetRow ? data.find((r) => r.id === sheetRow.id) ?? sheetRow : null),
    [sheetRow, data],
  );
  const openSheet = useCallback((row: ReceivingLineRow) => setSheetRow(row), []);
  const closeSheet = useCallback(() => setSheetRow(null), []);
  const buildPhotosHref = useCallback(
    (row: ReceivingLineRow) => (row.receiving_id ? `/m/r/${row.receiving_id}/photos` : '#'),
    [],
  );

  return (
    <div className="flex h-full w-full flex-col bg-white">
      <MobileFeed<ReceivingLineRow>
        rows={rows}
        isLoading={isLoading}
        scrollRef={scrollRef}
        freshIds={freshIds}
        empty={
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-white px-6 text-center">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-gray-700">No packages yet</p>
            <p className="max-w-[260px] text-caption font-semibold text-gray-500">
              Scan a tracking number on the desktop to drop one in here.
            </p>
          </div>
        }
        renderRow={(row, { variant, fresh }) => (
          <MobileReceivingRow
            row={row}
            variant={variant}
            fresh={fresh}
            onTap={() => openSheet(row)}
            photosHref={buildPhotosHref(row)}
          />
        )}
      />

      <MobileCartonSheet row={liveSheetRow} staffId={staffId} open={sheetRow != null} onClose={closeSheet} />
    </div>
  );
}
