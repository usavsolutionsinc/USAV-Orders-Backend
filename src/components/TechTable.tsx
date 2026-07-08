'use client';

import { useCallback, useMemo } from 'react';
import { useEventBridge } from '@/hooks';
import { type TechRecord } from '@/hooks/useTechLogs';
import { useTechTableController } from '@/hooks/station/useTechTableController';
import { useStationDetailsSelection } from '@/hooks/station/useStationDetailsSelection';
import { StationWeekTable } from '@/components/station/StationWeekTable';
import { StationHistoryTable } from '@/components/station/StationHistoryTable';
import { TechRecordRow } from '@/components/station/TechRecordRow';
import { techRecordToDetail, getTechDetailId } from '@/components/station/tech-record-mappers';
import { STATION_VIRTUAL_LIST } from '@/lib/station/flags';
import { SAVED_VIEW_PARAM_KEYS, SAVED_VIEW_STORAGE_KEY } from '@/lib/station/table-url-params';
import { Calendar, Clock, Package } from '@/components/Icons';
import { toPSTDateKey } from '@/utils/date';
import type { SwimlaneLaneDef } from '@/components/board/SwimlaneBoard';
import {
  TECH_HISTORY_BOARD_LANES,
  TECH_HISTORY_STATE_META,
  bucketTechHistoryLane,
  type TechHistoryLane,
  type TechLaneIconKey,
} from '@/lib/station/tech-board-lanes';
import { techRecordToQueueRow } from '@/lib/station/record-to-queue-row';
import { formatTechCopyRow, TECH_COPY_HEADER } from '@/lib/station/format-station-copy-row';
import { TECH_HISTORY_SELECTION_SCOPE } from '@/lib/selection/station-scopes';

const TECH_LANE_ICON: Record<TechLaneIconKey, React.ComponentType<{ className?: string }>> = {
  clock: Clock,
  calendar: Calendar,
  package: Package,
};

/** Resolve the lane SoT descriptors + meta into the board's SwimlaneLaneDef. */
const TECH_LANES: SwimlaneLaneDef<TechHistoryLane>[] = TECH_HISTORY_BOARD_LANES.map((lane) => ({
  id: lane.id,
  label: TECH_HISTORY_STATE_META[lane.id].label,
  dot: TECH_HISTORY_STATE_META[lane.id].dot,
  description: TECH_HISTORY_STATE_META[lane.id].description,
  icon: TECH_LANE_ICON[lane.iconKey],
  iconClass: lane.iconClass,
}));

interface TechTableProps {
  testedBy: number;
}

/** Newest-first by pack/test time (created_at). */
function byNewestCreated(a: TechRecord, b: TechRecord): number {
  return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
}

export function TechTable({ testedBy }: TechTableProps) {
  const {
    weekOffset, setWeekOffset, weekRange,
    groupedRecords, loading, isRefreshing,
    getRowKey, setRemovedRowKeys,
    scrollRef,
  } = useTechTableController({ staffId: testedBy });

  // Week-scoped day bands (newest day first, each day newest-first).
  const daySections = useMemo<[string, TechRecord[]][]>(
    () =>
      Object.entries(groupedRecords)
        .filter(([date]) => date >= weekRange.startStr && date <= weekRange.endStr)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([date, recs]) => [date, [...recs].sort(byNewestCreated)] as [string, TechRecord[]]),
    [groupedRecords, weekRange.startStr, weekRange.endStr],
  );
  const orderedRecords = useMemo(() => daySections.flatMap(([, recs]) => recs), [daySections]);

  // Pipeline (board) grouping: bucket by the tech lane SoT, day-band per lane.
  const todayKey = toPSTDateKey(new Date());
  const techBucket = useCallback((r: TechRecord) => bucketTechHistoryLane(r, todayKey), [todayKey]);
  const toLaneDaySections = useCallback((recs: TechRecord[]): [string, TechRecord[]][] => {
    const byDay: Record<string, TechRecord[]> = {};
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
      .map(([date, recs2]) => [date, [...recs2].sort(byNewestCreated)] as [string, TechRecord[]]);
  }, []);

  const { openDetails, clearSelection } = useStationDetailsSelection<TechRecord>({
    orderedRecords,
    toDetailRecord: techRecordToDetail,
    getDetailId: getTechDetailId,
  });

  // A removed tech log drops out optimistically and closes any open detail.
  useEventBridge({
    'tech-log-removed': (e) => {
      const detail = (e as CustomEvent<{ sourceKind?: unknown; sourceRowId?: unknown }>).detail;
      const sourceKind = String(detail?.sourceKind || '').trim();
      const sourceRowId = Number(detail?.sourceRowId);
      if (!sourceKind || !Number.isFinite(sourceRowId) || sourceRowId <= 0) return;
      setRemovedRowKeys((current) => {
        const next = new Set(current);
        next.add(`${sourceKind}:${sourceRowId}`);
        return next;
      });
      clearSelection();
    },
  });

  const renderRow = useCallback(
    (record: TechRecord, index: number) => (
      <TechRecordRow key={getRowKey(record)} record={record} index={index} onOpen={openDetails} />
    ),
    [getRowKey, openDetails],
  );

  // Flag-gated cutover: the unified virtualized shell (week band + ⋮ menu + density
  // + per-staff columns) once `NEXT_PUBLIC_STATION_VIRTUAL_LIST=1`; the legacy
  // `StationWeekTable` stays the default until bake-in. Same rows either way.
  if (STATION_VIRTUAL_LIST) {
    return (
      <StationHistoryTable<TechRecord>
        loading={loading}
        isRefreshing={isRefreshing}
        weekRange={weekRange}
        weekOffset={weekOffset}
        onPrevWeek={() => setWeekOffset(weekOffset + 1)}
        onNextWeek={() => setWeekOffset(Math.max(0, weekOffset - 1))}
        onResetWeek={() => setWeekOffset(0)}
        daySections={daySections}
        renderRow={renderRow}
        getRowKey={(record) => getRowKey(record)}
        tableId="tech"
        virtualized
        savedViewsStorageKey={SAVED_VIEW_STORAGE_KEY.tech_history}
        savedViewsParamKeys={SAVED_VIEW_PARAM_KEYS.tech_history}
        emptyMessage="No tech records found"
        pipeline={{
          records: orderedRecords,
          lanes: TECH_LANES,
          bucket: techBucket,
          prefsKey: 'techHistoryBoard',
          toDaySections: toLaneDaySections,
          getRowDate: (r) => r.created_at,
        }}
        selection={{
          scope: TECH_HISTORY_SELECTION_SCOPE,
          queueMode: 'tech',
          toQueueRow: techRecordToQueueRow,
          getRecordId: (r) => r.id,
          onOpen: openDetails,
          formatCopyRow: formatTechCopyRow,
          copyHeader: TECH_COPY_HEADER,
          deepLinkParam: 'techLogId',
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
      emptyMessage="No tech records found"
      scrollRef={scrollRef}
      renderRow={renderRow}
      tableId="tech"
    />
  );
}
