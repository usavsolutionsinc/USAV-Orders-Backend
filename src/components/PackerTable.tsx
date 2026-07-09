'use client';

import { useCallback, useMemo } from 'react';
import { type PackerRecord } from '@/hooks/usePackerLogs';
import { usePackerTableController } from '@/hooks/station/usePackerTableController';
import { useStationDetailsSelection } from '@/hooks/station/useStationDetailsSelection';
import { StationWeekTable } from '@/components/station/StationWeekTable';
import { StationHistoryTable } from '@/components/station/StationHistoryTable';
import { PackerRecordRow } from '@/components/station/PackerRecordRow';
import { packerRecordToDetail, getPackerDetailId } from '@/components/station/packer-record-mappers';
import { STATION_VIRTUAL_LIST } from '@/lib/station/flags';
import { SAVED_VIEW_PARAM_KEYS, SAVED_VIEW_STORAGE_KEY } from '@/lib/station/table-url-params';
import { AlertTriangle, Calendar, Clock, Package } from '@/components/Icons';
import { toPSTDateKey } from '@/utils/date';
import type { SwimlaneLaneDef } from '@/components/board/SwimlaneBoard';
import {
  PACKER_HISTORY_BOARD_LANES,
  PACKER_HISTORY_STATE_META,
  bucketPackerHistoryLane,
  type PackerHistoryLane,
  type PackerLaneIconKey,
} from '@/lib/station/packer-board-lanes';
import { packerRecordToQueueRow } from '@/lib/station/record-to-queue-row';
import { formatPackerCopyRow, PACKER_COPY_HEADER } from '@/lib/station/format-station-copy-row';
import { PACKER_HISTORY_SELECTION_SCOPE } from '@/lib/selection/station-scopes';

const PACKER_LANE_ICON: Record<PackerLaneIconKey, React.ComponentType<{ className?: string }>> = {
  clock: Clock,
  calendar: Calendar,
  package: Package,
  alert: AlertTriangle,
};

const PACKER_LANES: SwimlaneLaneDef<PackerHistoryLane>[] = PACKER_HISTORY_BOARD_LANES.map((lane) => ({
  id: lane.id,
  label: PACKER_HISTORY_STATE_META[lane.id].label,
  dot: PACKER_HISTORY_STATE_META[lane.id].dot,
  description: PACKER_HISTORY_STATE_META[lane.id].description,
  icon: PACKER_LANE_ICON[lane.iconKey],
  iconClass: lane.iconClass,
}));

interface PackerTableProps {
  packedBy: number;
}

/** Newest-first by pack time (created_at). */
function byNewestCreated(a: PackerRecord, b: PackerRecord): number {
  return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
}

export function PackerTable({ packedBy }: PackerTableProps) {
  const {
    weekOffset,
    setWeekOffset,
    weekRange,
    filteredGroupedRecords,
    orderedRecords,
    loading,
    isRefreshing,
    scrollRef,
  } = usePackerTableController({ staffId: packedBy });

  // Day bands (newest day first, each day newest-first) for rendering. The
  // controller's `orderedRecords` drives keyboard navigation.
  const daySections = useMemo<[string, PackerRecord[]][]>(
    () =>
      Object.entries(filteredGroupedRecords)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([date, recs]) => [date, [...recs].sort(byNewestCreated)] as [string, PackerRecord[]]),
    [filteredGroupedRecords],
  );

  const { openDetails } = useStationDetailsSelection<PackerRecord>({
    orderedRecords,
    toDetailRecord: packerRecordToDetail,
    getDetailId: getPackerDetailId,
  });

  // Pipeline (board) grouping: bucket by the packer lane SoT, day-band per lane.
  const todayKey = toPSTDateKey(new Date());
  const packerBucket = useCallback((r: PackerRecord) => bucketPackerHistoryLane(r, todayKey), [todayKey]);
  const toLaneDaySections = useCallback((recs: PackerRecord[]): [string, PackerRecord[]][] => {
    const byDay: Record<string, PackerRecord[]> = {};
    for (const r of recs) {
      let key = 'Unknown';
      try {
        key = toPSTDateKey(r.created_at) || 'Unknown';
      } catch {
        key = 'Unknown';
      }
      (byDay[key] ??= []).push(r);
    }
    return Object.entries(byDay)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, recs2]) => [date, [...recs2].sort(byNewestCreated)] as [string, PackerRecord[]]);
  }, []);

  const renderRow = useCallback(
    (record: PackerRecord, index: number, date: string) => (
      <PackerRecordRow
        key={
          record.id != null
            ? `pkr-${record.id}`
            : `pkr-${date}-${index}-${record.shipping_tracking_number || record.scan_ref || record.order_id || 'row'}`
        }
        record={record}
        index={index}
        onOpen={openDetails}
      />
    ),
    [openDetails],
  );

  // Flag-gated cutover to the unified virtualized shell — same rows, adds windowing
  // + week band + ⋮ (density + saved views) + per-staff columns. Legacy default.
  if (STATION_VIRTUAL_LIST) {
    return (
      <StationHistoryTable<PackerRecord>
        loading={loading}
        isRefreshing={isRefreshing}
        weekRange={weekRange}
        weekOffset={weekOffset}
        onPrevWeek={() => setWeekOffset(weekOffset + 1)}
        onNextWeek={() => setWeekOffset(Math.max(0, weekOffset - 1))}
        onResetWeek={() => setWeekOffset(0)}
        daySections={daySections}
        renderRow={(record, index) => renderRow(record, index, '')}
        getRowKey={(record, index) => (record.id != null ? `pkr-${record.id}` : `pkr-${index}`)}
        tableId="packer"
        virtualized
        savedViewsStorageKey={SAVED_VIEW_STORAGE_KEY.packer_history}
        savedViewsParamKeys={SAVED_VIEW_PARAM_KEYS.packer_history}
        emptyMessage="No packer records found"
        pipeline={{
          records: orderedRecords,
          lanes: PACKER_LANES,
          bucket: packerBucket,
          prefsKey: 'packerHistoryBoard',
          toDaySections: toLaneDaySections,
          getRowDate: (r) => r.created_at,
        }}
        selection={{
          scope: PACKER_HISTORY_SELECTION_SCOPE,
          queueMode: 'packer',
          toQueueRow: packerRecordToQueueRow,
          getRecordId: (r) => r.id,
          onOpen: openDetails,
          formatCopyRow: formatPackerCopyRow,
          copyHeader: PACKER_COPY_HEADER,
          deepLinkParam: 'packLogId',
        }}
      />
    );
  }

  return (
    <StationWeekTable
      loading={loading}
      isRefreshing={isRefreshing}
      weekRange={weekRange}
      weekOffset={weekOffset}
      onPrevWeek={() => setWeekOffset(weekOffset + 1)}
      onNextWeek={() => setWeekOffset(Math.max(0, weekOffset - 1))}
      daySections={daySections}
      emptyMessage="No packer records found"
      scrollRef={scrollRef}
      renderRow={renderRow}
      tableId="packer"
    />
  );
}
