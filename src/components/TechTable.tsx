'use client';

import { useCallback, useMemo } from 'react';
import { useEventBridge } from '@/hooks';
import { type TechRecord } from '@/hooks/useTechLogs';
import { useTechTableController } from '@/hooks/station/useTechTableController';
import { useStationDetailsSelection } from '@/hooks/station/useStationDetailsSelection';
import { StationWeekTable } from '@/components/station/StationWeekTable';
import { TechRecordRow } from '@/components/station/TechRecordRow';
import { techRecordToDetail, getTechDetailId } from '@/components/station/tech-record-mappers';

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
    />
  );
}
