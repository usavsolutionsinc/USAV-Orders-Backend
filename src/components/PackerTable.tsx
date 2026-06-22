'use client';

import { useCallback, useMemo } from 'react';
import { type PackerRecord } from '@/hooks/usePackerLogs';
import { usePackerTableController } from '@/hooks/station/usePackerTableController';
import { useStationDetailsSelection } from '@/hooks/station/useStationDetailsSelection';
import { StationWeekTable } from '@/components/station/StationWeekTable';
import { PackerRecordRow } from '@/components/station/PackerRecordRow';
import { packerRecordToDetail, getPackerDetailId } from '@/components/station/packer-record-mappers';

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
    />
  );
}
