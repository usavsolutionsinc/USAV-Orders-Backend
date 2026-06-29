'use client';

import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import {
  safeChannelName,
  getPhoneBridgeChannelName,
  getStaffStationBridgeChannelName,
  getStationChannelName,
} from '@/lib/realtime/channels';
import { useRealtimeToasts } from '@/hooks/useRealtimeToasts';
import { useNasConfig } from '@/hooks/useNasConfig';
import {
  MobilePackageGroup,
  MobileReceivingUnitCard,
  type ReceivingCardCallbacks,
} from '@/components/mobile/receiving/MobileReceivingCards';
import {
  groupReceivingEntries,
  type ReceivingFeedEntry,
} from '@/components/mobile/receiving/receiving-feed-entries';
import { MobileCartonSheet } from '@/components/mobile/receiving/MobileCartonSheet';
import { MobileReceivingFeedGallery } from '@/components/mobile/receiving/MobileReceivingFeedGallery';
import { MobileFeed } from '@/components/mobile/feed/MobileFeed';
import { useFeedWindow, useMobileFeedQuery } from '@/components/mobile/feed/useMobileFeed';
import { receivingLinePhotoHrefs } from '@/lib/photos/mobile-gallery-url';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

interface ApiResponse {
  success: boolean;
  receiving_lines: ReceivingLineRow[];
}

// Mirror the desktop UNBOX-mode rail exactly — the "Unboxed" sub-view of
// /receiving?mode=receive is ReceivingRecentRail (view=activity, sort=
// unboxed_newest, all-staff). Same view+sort here ⇒ the mobile feed renders the
// identical list. Distinct `rail` key (vs ReceivingRecentRail's 6-segment
// staff-keyed key) because this query returns a plain array while the rail
// caches the full ApiResponse object — same key would collide on shape. Still
// under the 'receiving-lines-table' prefix so broad invalidations refresh it.
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
  // Seed runtime NAS base (/api/nas) before capture routes or the carton sheet open.
  useNasConfig();

  const { data, isLoading, refetch } = useMobileFeedQuery<ReceivingLineRow>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      // Mirror ReceivingRecentRail (the unbox-mode "Unboxed" rail): the UNBOXING
      // pipeline (view=activity) with serials, sorted by unboxed_at DESC, so this
      // feed shows the exact same lines in the same order as the desktop rail.
      const params = new URLSearchParams({
        limit: '500',
        offset: '0',
        view: 'activity',
        include: 'serials',
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

  const stationChannel = safeChannelName(() => getStationChannelName(orgId!));
  useAblyChannel(
    stationChannel,
    'receiving-photo.changed',
    refetch,
    !!stationChannel,
  );

  const { rows, scrollRef, freshIds } = useFeedWindow(data, { limit, anchor: 'bottom' });

  // Collapse carton-mates into package entries for rendering — windowing, scroll,
  // and fresh-pulse stay line-level (above) so the existing feed mechanics are
  // untouched; grouping is purely presentational.
  const entries = useMemo<ReceivingFeedEntry[]>(() => groupReceivingEntries(rows), [rows]);

  const [sheetRow, setSheetRow] = useState<ReceivingLineRow | null>(null);
  const [feedGalleryReceivingId, setFeedGalleryReceivingId] = useState<number | null>(null);
  // Re-derive the open sheet's row from the live feed so its CTA photo count
  // updates after an upload — the stored `sheetRow` snapshot would stay stale.
  const liveSheetRow = useMemo(
    () => (sheetRow ? data.find((r) => r.id === sheetRow.id) ?? sheetRow : null),
    [sheetRow, data],
  );
  const openSheet = useCallback((row: ReceivingLineRow) => setSheetRow(row), []);
  const closeSheet = useCallback(() => setSheetRow(null), []);
  const openFeedGallery = useCallback((row: ReceivingLineRow) => {
    if (!row.receiving_id) return;
    setFeedGalleryReceivingId(row.receiving_id);
  }, []);
  const closeFeedGallery = useCallback(() => setFeedGalleryReceivingId(null), []);
  const buildPhotoHrefs = useCallback((row: ReceivingLineRow) => {
    const poValue = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').toString().trim();
    return receivingLinePhotoHrefs({
      receivingId: row.receiving_id,
      lineId: row.id,
      itemName: row.item_name,
      sku: row.sku,
      zohoItemId: row.zoho_item_id,
      poRef: poValue || undefined,
      back: '/m/receiving',
    });
  }, []);

  // Bottom-anchored feed: rows are oldest→newest, so the last one is the
  // bottom-most (newest) line — the only row that renders the big photo display.
  const expandedLineId = rows.length ? rows[rows.length - 1].id : null;

  const cardCallbacks = useMemo<ReceivingCardCallbacks>(
    () => ({
      buildHrefs: buildPhotoHrefs,
      onOpenGallery: openFeedGallery,
      onOpenSheet: openSheet,
      isFresh: (row) => freshIds.has(row.id),
      isExpanded: (row) => row.id === expandedLineId,
    }),
    [buildPhotoHrefs, openFeedGallery, openSheet, freshIds, expandedLineId],
  );

  return (
    <div className="flex h-full w-full max-w-full flex-col overflow-x-hidden bg-white">
      <MobileFeed<ReceivingFeedEntry>
        rows={entries}
        isLoading={isLoading}
        scrollRef={scrollRef}
        getId={(entry) => entry.key}
        empty={
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-white px-6 text-center">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-gray-700">No packages yet</p>
            <p className="max-w-[260px] text-caption font-semibold text-gray-500">
              Scan a tracking number on the desktop to drop one in here.
            </p>
          </div>
        }
        renderRow={(entry) =>
          entry.kind === 'package' ? (
            <MobilePackageGroup entry={entry} cb={cardCallbacks} />
          ) : (
            <MobileReceivingUnitCard row={entry.unit} cb={cardCallbacks} />
          )
        }
      />

      <MobileCartonSheet
        row={liveSheetRow}
        staffId={staffId}
        open={sheetRow != null}
        onClose={closeSheet}
      />

      <MobileReceivingFeedGallery
        receivingId={feedGalleryReceivingId}
        staffId={staffId}
        open={feedGalleryReceivingId != null}
        onClose={closeFeedGallery}
      />
    </div>
  );
}
