'use client';

import { useCallback, type ReactNode } from 'react';
import { SwimlaneBoard, type SwimlaneLaneDef } from '@/components/board/SwimlaneBoard';
import { StationListTable } from '@/components/station/StationListTable';
import type { BoardPrefsKey } from '@/lib/neon/staff-preferences-queries';

/**
 * `StationPipelineBoard<T, LaneId>` — the Pipeline (board) layout for the station
 * history tables (station-table-unification-plan §Phase 4). A thin consumer of the
 * shared {@link SwimlaneBoard}: the surface supplies its lane model + `bucket`
 * (from the lane SoT modules) + the same `renderRow` the dense table uses, and
 * each lane body is a content-sized, day-banded {@link StationListTable} that
 * windows against the board's single scroll region (the Phase V0 stacked-lane
 * ancestor-scroll fix). Add a lane → extend the surface's lane SoT; nothing here
 * changes.
 */
export interface StationPipelineBoardProps<T, LaneId extends string> {
  prefsKey: BoardPrefsKey;
  lanes: SwimlaneLaneDef<LaneId>[];
  bucket: (row: T) => LaneId;
  records: T[];
  loading: boolean;
  renderRow: (record: T, index: number) => ReactNode;
  getRowKey?: (record: T, index: number) => string;
  /** Group one lane's bucket into day bands (newest day first). */
  toDaySections: (records: T[]) => [string, T[]][];
  /** Field the per-lane date picker filters on (omit to drop it). */
  getRowDate?: (row: T) => string | null | undefined;
  headerStartSlot?: ReactNode;
  headerEndSlot?: ReactNode;
}

export function StationPipelineBoard<T, LaneId extends string>({
  prefsKey,
  lanes,
  bucket,
  records,
  loading,
  renderRow,
  getRowKey,
  toDaySections,
  getRowDate,
  headerStartSlot,
  headerEndSlot,
}: StationPipelineBoardProps<T, LaneId>) {
  const renderLaneBody = useCallback(
    ({
      laneLabel,
      rows,
      maxBodyHeightClass,
      maxBodyHeightPx,
      growToContent,
      scrollParentRef,
    }: {
      laneLabel: string;
      rows: T[];
      maxBodyHeightClass?: string;
      maxBodyHeightPx?: number;
      growToContent?: boolean;
      scrollParentRef?: React.RefObject<HTMLElement | null>;
    }) => (
      <StationListTable<T>
        hideHeader
        virtualized
        autoHeight
        noHorizontalScroll
        growToContent={growToContent}
        maxBodyHeightClass={maxBodyHeightClass}
        maxBodyHeightPx={maxBodyHeightPx}
        scrollParentRef={scrollParentRef}
        loading={loading}
        isRefreshing={false}
        totalCount={rows.length}
        daySections={toDaySections(rows)}
        renderRow={renderRow}
        getRowKey={getRowKey}
        emptyMessage={`No ${laneLabel.toLowerCase()} records`}
      />
    ),
    [loading, renderRow, getRowKey, toDaySections],
  );

  return (
    <SwimlaneBoard<T, LaneId, never>
      prefsKey={prefsKey}
      lanes={lanes}
      bucket={bucket}
      records={records}
      maxColumns={2}
      getRowDate={getRowDate}
      headerStartSlot={headerStartSlot}
      headerEndSlot={headerEndSlot}
      renderLaneBody={renderLaneBody}
    />
  );
}
