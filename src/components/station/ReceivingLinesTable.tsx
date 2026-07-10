'use client';

/**
 * Receiving-lines table — thin composition layer.
 *
 * The data/selection/grouping/navigation logic lives in focused hooks, and the
 * row/summary/list rendering in dedicated components, all under
 * `@/components/station/`:
 *   - useReceivingModeContext ..... URL → mode descriptor + parsed context
 *   - useReceivingLinesData ....... list + delivered-unscanned queries + localRows
 *   - useReceivingGrouping ........ dedupe → PO groups → day bands → ordered rows
 *   - useReceivingRowSelection .... single + bulk selection + event bridges
 *   - useReceivingTableNavigation . arrow/chevron + detail-overlay nav
 *   - useReceivingDeepLink ........ ?recvId/?lineId auto-select
 *   - useReceivingAutoWeek ........ History empty-week back-jump
 *   - ReceivingGroupedList ........ the day-banded, PO-grouped render
 *
 * The public exports below (types, dispatchers, the row component, the
 * synthetic-id helpers) are re-exported here so the ~50 existing importers of
 * `@/components/station/ReceivingLinesTable` keep working unchanged.
 */

import { useRef, useState } from 'react';
import { useUIModeOptional } from '@/design-system/providers/UIModeProvider';
import { SkeletonList } from '@/design-system/components/Skeletons';
import DateRangeHeader from '@/components/ui/DateRangeHeader';
import { IncomingPaneHeader } from '@/components/sidebar/receiving/IncomingPaneHeader';
import { computeWeekRange, toPSTDateKey } from '@/utils/date';

import { useReceivingModeContext } from '@/components/station/useReceivingModeContext';
import { useReceivingLinesData } from '@/components/station/useReceivingLinesData';
import { useReceivingGrouping } from '@/components/station/useReceivingGrouping';
import { useReceivingRowSelection } from '@/components/station/useReceivingRowSelection';
import { useReceivingTableNavigation } from '@/components/station/useReceivingTableNavigation';
import { useReceivingDeepLink } from '@/components/station/useReceivingDeepLink';
import { useReceivingAutoWeek } from '@/components/station/useReceivingAutoWeek';
import { ReceivingGroupedList } from '@/components/station/ReceivingGroupedList';
import { ReceivingLineOrderRow } from '@/components/station/ReceivingLineOrderRow';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { StationPipelineBoard } from '@/components/station/StationPipelineBoard';
import { STATION_PIPELINE_BOARDS, STATION_VIRTUAL_LIST } from '@/lib/station/flags';
import { LAYOUT_PARAM, parseLayout } from '@/lib/station/table-url-params';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Check, Clock, Inbox, Search, Truck } from '@/components/Icons';
import type { SwimlaneLaneDef } from '@/components/board/SwimlaneBoard';
import {
  RECEIVING_INCOMING_BOARD_LANES,
  RECEIVING_INCOMING_STATE_META,
  RECEIVING_HISTORY_BOARD_LANES,
  RECEIVING_HISTORY_STATE_META,
  bucketReceivingIncomingLane,
  bucketReceivingHistoryLane,
  type ReceivingIncomingLane,
  type ReceivingHistoryLane,
  type ReceivingLaneIconKey,
} from '@/lib/receiving/receiving-board-lanes';

const RECEIVING_LANE_ICON: Record<ReceivingLaneIconKey, React.ComponentType<{ className?: string }>> = {
  inbox: Inbox,
  truck: Truck,
  clock: Clock,
  alert: AlertTriangle,
  check: Check,
  search: Search,
};

const RECEIVING_INCOMING_LANES: SwimlaneLaneDef<ReceivingIncomingLane>[] = RECEIVING_INCOMING_BOARD_LANES.map((l) => ({
  id: l.id,
  label: RECEIVING_INCOMING_STATE_META[l.id].label,
  dot: RECEIVING_INCOMING_STATE_META[l.id].dot,
  description: RECEIVING_INCOMING_STATE_META[l.id].description,
  icon: RECEIVING_LANE_ICON[l.iconKey],
  iconClass: l.iconClass,
}));

const RECEIVING_HISTORY_LANES: SwimlaneLaneDef<ReceivingHistoryLane>[] = RECEIVING_HISTORY_BOARD_LANES.map((l) => ({
  id: l.id,
  label: RECEIVING_HISTORY_STATE_META[l.id].label,
  dot: RECEIVING_HISTORY_STATE_META[l.id].dot,
  description: RECEIVING_HISTORY_STATE_META[l.id].description,
  icon: RECEIVING_LANE_ICON[l.iconKey],
  iconClass: l.iconClass,
}));
import { TableColumnConfigProvider } from '@/components/ui/table-column-config/TableColumnConfig';
import { ColumnConfigButton } from '@/components/ui/table-column-config/ColumnConfigButton';

// ── Public re-exports (preserve the historical import surface) ──────────────
export type { ReceivingView } from '@/lib/receiving/receiving-views';
// `ReceivingLineRow` lives in a leaf module so low-level utils/lib helpers can
// reference the shape without importing this heavy component. Re-exported so the
// ~50 existing `from '@/components/station/ReceivingLinesTable'` importers work.
export type { ReceivingLineRow } from './receiving-line-row';
export {
  dispatchSelectLine,
  dispatchLineUpdated,
  dispatchReceivingCartonUnlinkPatch,
  mergeReceivingPackageMetaIntoRow,
  RECEIVING_UNPAIR_ROW_PATCH,
  RECEIVING_SELECTION_SCOPE,
} from '@/components/station/receiving-lines-table-helpers';
export {
  DELIVERED_UNSCANNED_SYNTHETIC_ID_BASE,
  shipmentIdFromDeliveredUnscannedRow,
} from '@/components/station/receiving-delivered-unscanned';
export { ReceivingLineOrderRow } from '@/components/station/ReceivingLineOrderRow';

export default function ReceivingLinesTable({ selectMode = false }: { selectMode?: boolean } = {}) {
  const { isMobile } = useUIModeOptional();
  const searchParams = useSearchParams();
  const [weekOffset, setWeekOffset] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const weekRange = computeWeekRange(weekOffset);

  const {
    mode,
    isIncomingMode,
    isHistoryMode,
    historyAxis,
    incomingPage,
    isDeliveredUnscannedFacet,
    isDeliveredNotUnboxedFacet,
    skipWeekFilter,
    modeContext,
  } = useReceivingModeContext();

  const { data, isLoading, deliveredRows, localRows } = useReceivingLinesData({
    mode,
    modeContext,
    isIncomingMode,
    isDeliveredUnscannedFacet,
    isDeliveredNotUnboxedFacet,
    incomingPage,
    setWeekOffset,
    scrollRef,
  });

  const { groupedRecords, filteredGroupedRecords, orderedVisibleRows, getWeekCount } =
    useReceivingGrouping({ localRows, mode, historyAxis, weekRange, skipWeekFilter });

  const { selectedId, setSelectedId, selectedIds, handleSelectRow, selectedIdRef, selectModeRef } =
    useReceivingRowSelection({ selectMode, localRows, orderedVisibleRows });

  useReceivingTableNavigation({
    orderedVisibleRows,
    handleSelectRow,
    selectedIdRef,
    selectModeRef,
    scrollRef,
    selectedId,
    // History/Incoming own the chevron channel; Unbox/Triage route it to the rail.
    tableNavEnabled: isHistoryMode || isIncomingMode,
  });

  useReceivingDeepLink({ isLoading, localRows, setSelectedId });

  useReceivingAutoWeek({
    isHistoryMode,
    skipWeekFilter,
    weekOffset,
    setWeekOffset,
    filteredGroupedRecords,
    groupedRecords,
    weekRange,
  });

  const emptyMessage = mode.emptyMessage(modeContext);

  // Pipeline (board) layout for Incoming / History (behind the boards flag). The
  // board buckets the flat rows by the receiving lane SoT and day-bands per lane;
  // it replaces the header + dense list (SwimlaneBoard supplies its own toolbar).
  const layout = parseLayout(searchParams.get(LAYOUT_PARAM));
  const showReceivingBoard = STATION_PIPELINE_BOARDS && layout === 'board' && (isIncomingMode || isHistoryMode);

  if (showReceivingBoard) {
    const nowMs = Date.now();
    const toReceivingDaySections = (recs: ReceivingLineRow[]): [string, ReceivingLineRow[]][] => {
      const byDay: Record<string, ReceivingLineRow[]> = {};
      for (const r of recs) {
        let key = 'Unknown';
        try {
          key = toPSTDateKey(r.created_at ?? undefined) || 'Unknown';
        } catch {
          key = 'Unknown';
        }
        (byDay[key] ??= []).push(r);
      }
      return Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0]));
    };
    const renderReceivingRow = (row: ReceivingLineRow, index: number) => (
      <ReceivingLineOrderRow
        key={row.id}
        row={row}
        index={index}
        isMobile={isMobile}
        isIncoming={isIncomingMode}
        isHistory={isHistoryMode}
        selectMode={selectMode}
        isSelected={selectMode ? selectedIds.has(row.id) : selectedId === row.id}
        onSelect={() => handleSelectRow(row)}
      />
    );
    return (
      <TableColumnConfigProvider tableId="receiving">
        <div className="flex h-full min-w-0 overflow-hidden bg-surface-card">
          {isIncomingMode ? (
            <StationPipelineBoard<ReceivingLineRow, ReceivingIncomingLane>
              prefsKey="receivingIncomingBoard"
              lanes={RECEIVING_INCOMING_LANES}
              bucket={(r) => bucketReceivingIncomingLane(r)}
              records={orderedVisibleRows}
              loading={isLoading && localRows.length === 0}
              renderRow={renderReceivingRow}
              getRowKey={(row) => String(row.id)}
              toDaySections={toReceivingDaySections}
              getRowDate={(r) => r.created_at}
            />
          ) : (
            <StationPipelineBoard<ReceivingLineRow, ReceivingHistoryLane>
              prefsKey="receivingHistoryBoard"
              lanes={RECEIVING_HISTORY_LANES}
              bucket={(r) => bucketReceivingHistoryLane(r, nowMs)}
              records={orderedVisibleRows}
              loading={isLoading && localRows.length === 0}
              renderRow={renderReceivingRow}
              getRowKey={(row) => String(row.id)}
              toDaySections={toReceivingDaySections}
              getRowDate={(r) => r.created_at}
            />
          )}
        </div>
      </TableColumnConfigProvider>
    );
  }

  return (
    <TableColumnConfigProvider tableId="receiving">
    <div className="flex h-full min-w-0 overflow-hidden bg-surface-card">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {isIncomingMode ? (
          // Incoming gets its own purpose-built header — title + count +
          // pagination. The sidebar (IncomingSidebarPanel) owns search + facet
          // chips + PO date range + Sort. `total` comes straight from the API
          // response so the "N of M" label stays in sync with the active filter.
          <IncomingPaneHeader
            total={
              isDeliveredUnscannedFacet || isDeliveredNotUnboxedFacet
                ? localRows.length
                : Number(data?.total ?? 0)
            }
            page={incomingPage}
          />
        ) : (
          <DateRangeHeader
            count={getWeekCount()}
            columns={<ColumnConfigButton iconOnly />}
            weekRange={weekRange}
            weekOffset={weekOffset}
            onPrevWeek={() => setWeekOffset(weekOffset + 1)}
            onNextWeek={() => setWeekOffset(Math.max(0, weekOffset - 1))}
          />
        )}
        <div ref={scrollRef} data-testid="column-table-body" className="min-h-0 flex-1 overflow-auto">
          {isLoading && localRows.length === 0 ? (
            <div className="p-3">
              <SkeletonList count={12} type="row" />
            </div>
          ) : Object.keys(filteredGroupedRecords).length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm font-semibold text-text-soft">{emptyMessage}</p>
            </div>
          ) : (
            <ReceivingGroupedList
              filteredGroupedRecords={filteredGroupedRecords}
              serverSorted={mode.serverSorted}
              isMobile={isMobile}
              isIncomingMode={isIncomingMode}
              isHistoryMode={isHistoryMode}
              selectMode={selectMode}
              selectedId={selectedId}
              selectedIds={selectedIds}
              handleSelectRow={handleSelectRow}
              virtualized={STATION_VIRTUAL_LIST}
              scrollParentRef={scrollRef}
            />
          )}
        </div>
      </div>
    </div>
    </TableColumnConfigProvider>
  );
}
