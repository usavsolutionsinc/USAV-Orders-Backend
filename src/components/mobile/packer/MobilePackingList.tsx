'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRealtimeToasts } from '@/hooks/useRealtimeToasts';
import { MobilePackingRow } from '@/components/mobile/packer/MobilePackingRow';
import { MobilePackingSheet } from '@/components/mobile/packer/MobilePackingSheet';
import { MobileFeed } from '@/components/mobile/feed/MobileFeed';
import { useFeedWindow, useMobileFeedQuery } from '@/components/mobile/feed/useMobileFeed';
import type { PackerLogRow } from '@/components/mobile/packer/types';

/**
 * Mobile packer surface — mirror of {@link MobileReceivingList}. Recent packed
 * logs, newest pinned at the bottom; tap opens MobilePackingSheet, the expanded
 * card's camera chip jumps to /m/p/{packerLogId}/photos.
 *
 * Shares all display logic with the other mobile feeds via useMobileFeedQuery /
 * useFeedWindow / MobileFeed. `limit` defaults to 8 (one phone screen).
 */
export function MobilePackingList({ packerId, limit = 8 }: { packerId: string; limit?: number }) {
  useRealtimeToasts('packer');

  const queryKey = useMemo(() => ['packer-logs-mobile', packerId] as const, [packerId]);

  const { data, isLoading } = useMobileFeedQuery<PackerLogRow>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ packerId: String(packerId), limit: '30', offset: '0' });
      const res = await fetch(`/api/packerlogs?${params.toString()}`);
      if (!res.ok) throw new Error('fetch failed');
      const json = await res.json();
      return Array.isArray(json) ? (json as PackerLogRow[]) : [];
    },
    realtime: { windowEvents: ['packer-log-updated', 'usav-refresh-data'] },
  });

  const { rows, scrollRef, freshIds } = useFeedWindow(data, { limit, anchor: 'bottom' });

  const [sheetRow, setSheetRow] = useState<PackerLogRow | null>(null);
  const openSheet = useCallback((row: PackerLogRow) => setSheetRow(row), []);
  const closeSheet = useCallback(() => setSheetRow(null), []);
  const buildPhotosHref = useCallback((row: PackerLogRow) => {
    if (!row.packer_log_id) return '#';
    // Carry the real order number so packer photos file under it in the library
    // (poRef) instead of the fallback PL-{id}.
    const oid = (row.order_id || '').trim();
    const q = oid ? `?orderId=${encodeURIComponent(oid)}` : '';
    return `/m/p/${row.packer_log_id}/photos${q}`;
  }, []);

  return (
    <div className="flex h-full w-full flex-col bg-white">
      <MobileFeed<PackerLogRow>
        rows={rows}
        isLoading={isLoading}
        scrollRef={scrollRef}
        freshIds={freshIds}
        empty={
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-white px-6 text-center">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-gray-700">No pack history yet</p>
            <p className="max-w-[260px] text-caption font-semibold text-gray-500">
              Pack something at a desktop station — recent entries will land here.
            </p>
          </div>
        }
        renderRow={(row, { variant, fresh }) => (
          <MobilePackingRow
            row={row}
            variant={variant}
            fresh={fresh}
            onTap={() => openSheet(row)}
            photosHref={buildPhotosHref(row)}
          />
        )}
      />

      <MobilePackingSheet row={sheetRow} open={sheetRow != null} onClose={closeSheet} />
    </div>
  );
}
