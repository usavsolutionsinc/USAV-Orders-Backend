'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SkeletonList } from '@/design-system/components/Skeletons';
import { useUIModeOptional } from '@/design-system/providers/UIModeProvider';
import {
  ReceivingLineOrderRow,
  dispatchSelectLine,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';
import { emitSelection, emitSelectionTotal, onToggleAll } from '@/lib/selection/table-selection';
import { StationListTable } from '@/components/station/StationListTable';
import { StationPipelineBoard } from '@/components/station/StationPipelineBoard';
import { STATION_PIPELINE_BOARDS, STATION_VIRTUAL_LIST } from '@/lib/station/flags';
import { LAYOUT_PARAM, parseLayout } from '@/lib/station/table-url-params';
import { toPSTDateKey } from '@/utils/date';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Check, RefreshCw } from '@/components/Icons';
import type { SwimlaneLaneDef } from '@/components/board/SwimlaneBoard';
import {
  TESTING_HISTORY_BOARD_LANES,
  TESTING_HISTORY_STATE_META,
  bucketTestingHistoryLane,
  type TestingHistoryLane,
  type TestingLaneIconKey,
} from '@/lib/station/testing-board-lanes';
import { TESTING_RECEIVING_LINES_API } from '@/lib/surface-isolation';

const TESTING_LANE_ICON: Record<TestingLaneIconKey, React.ComponentType<{ className?: string }>> = {
  check: Check,
  alert: AlertTriangle,
  repeat: RefreshCw,
};

const TESTING_LANES: SwimlaneLaneDef<TestingHistoryLane>[] = TESTING_HISTORY_BOARD_LANES.map((lane) => ({
  id: lane.id,
  label: TESTING_HISTORY_STATE_META[lane.id].label,
  dot: TESTING_HISTORY_STATE_META[lane.id].dot,
  description: TESTING_HISTORY_STATE_META[lane.id].description,
  icon: TESTING_LANE_ICON[lane.iconKey],
  iconClass: lane.iconClass,
}));

/** Selection scope shared by the testing history list + its SelectionActionBar. */
export const TESTING_SELECTION_SCOPE = 'testing' as const;

interface ApiResponse {
  success: boolean;
  receiving_lines: ReceivingLineRow[];
  total: number;
}

interface TestingHistoryListProps {
  /** Tester staff id — scopes the `view=testing` feed to this tech's results. */
  staffId: string;
  /** Multi-select mode: rows show checkboxes; clicks toggle membership. */
  selectMode?: boolean;
  /** Non-select click → open the line in the testing workspace. */
  onOpenLine?: (row: ReceivingLineRow) => void;
}

/**
 * History view for the Testing sub-page — the full feed of lines this tech has
 * tested (`/api/receiving-lines?view=testing`), ordered most-recent first.
 *
 * Mirrors the Receiving History list: a flat list of {@link ReceivingLineOrderRow}
 * that supports the shared "Select → pick rows → act" flow on
 * {@link TESTING_SELECTION_SCOPE}. The recent rail in the sidebar stays the
 * quick-glance feed; this is the browse-and-bulk-act surface.
 */
export function TestingHistoryList({ staffId, selectMode = false, onOpenLine }: TestingHistoryListProps) {
  const { isMobile } = useUIModeOptional();
  const searchParams = useSearchParams();
  const testerId = staffId ? Number(staffId) : null;

  const { data, isLoading } = useQuery<ApiResponse>({
    queryKey: ['testing-history', testerId],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '500', offset: '0', include: 'serials', view: 'testing' });
      if (testerId) params.set('tester', String(testerId));
      const res = await fetch(`${TESTING_RECEIVING_LINES_API}?${params.toString()}`);
      if (!res.ok) throw new Error('fetch failed');
      return res.json();
    },
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });

  const rows = useMemo(
    () => (Array.isArray(data?.receiving_lines) ? data!.receiving_lines : []),
    [data],
  );

  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());

  // Broadcast resolved selection whenever the id set or rows change.
  useEffect(() => {
    if (!selectMode) return;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const selected: ReceivingLineRow[] = [];
    for (const id of selectedIds) {
      const row = byId.get(id);
      if (row) selected.push(row);
    }
    emitSelection(TESTING_SELECTION_SCOPE, selected);
  }, [selectMode, selectedIds, rows]);

  // Leaving select mode clears the selection.
  useEffect(() => {
    if (selectMode) return;
    setSelectedIds((prev) => (prev.size ? new Set() : prev));
    emitSelection(TESTING_SELECTION_SCOPE, []);
  }, [selectMode]);

  // Header "Select all" / "Clear".
  useEffect(() => {
    return onToggleAll(TESTING_SELECTION_SCOPE, (mode) => {
      setSelectedIds(mode === 'all' ? new Set(rows.map((r) => r.id)) : new Set());
    });
  }, [rows]);

  // Publish the selectable total so the action bar's select-all ring can fill.
  useEffect(() => {
    emitSelectionTotal(TESTING_SELECTION_SCOPE, selectMode ? rows.length : 0);
  }, [selectMode, rows]);

  const selectModeRef = useRef(selectMode);
  useEffect(() => { selectModeRef.current = selectMode; }, [selectMode]);

  const handleSelect = useCallback((row: ReceivingLineRow) => {
    if (selectModeRef.current) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(row.id)) next.delete(row.id);
        else next.add(row.id);
        return next;
      });
      return;
    }
    dispatchSelectLine(row);
    onOpenLine?.(row);
  }, [onOpenLine]);

  const renderRow = useCallback(
    (row: ReceivingLineRow, index: number) => (
      <ReceivingLineOrderRow
        key={row.id}
        row={row}
        index={index}
        isMobile={isMobile}
        selectMode={selectMode}
        isSelected={selectMode ? selectedIds.has(row.id) : false}
        onSelect={() => handleSelect(row)}
      />
    ),
    [isMobile, selectMode, selectedIds, handleSelect],
  );

  // Flag-gated cutover: day-banded + windowed via the unified StationListTable
  // (station-table-unification §Phase 3); the flat 500-row list stays default.
  if (STATION_VIRTUAL_LIST) {
    const toDaySections = (recs: ReceivingLineRow[]): [string, ReceivingLineRow[]][] => {
      const byDay: Record<string, ReceivingLineRow[]> = {};
      for (const r of recs) {
        let key = 'Unknown';
        try {
          key = toPSTDateKey(r.updated_at ?? r.created_at ?? undefined) || 'Unknown';
        } catch {
          key = 'Unknown';
        }
        (byDay[key] ??= []).push(r);
      }
      return Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0]));
    };

    // Pipeline (board) — verdict lanes (PASS/FAIL/RETEST), behind the boards flag.
    const layout = parseLayout(searchParams.get(LAYOUT_PARAM));
    if (STATION_PIPELINE_BOARDS && layout === 'board') {
      return (
        <div className="flex h-full min-w-0 flex-col overflow-hidden bg-surface-card">
          <StationPipelineBoard<ReceivingLineRow, TestingHistoryLane>
            prefsKey="testingHistoryBoard"
            lanes={TESTING_LANES}
            bucket={(r) => bucketTestingHistoryLane(r)}
            records={rows}
            loading={isLoading && rows.length === 0}
            renderRow={renderRow}
            getRowKey={(row) => String(row.id)}
            toDaySections={toDaySections}
            getRowDate={(r) => r.updated_at ?? r.created_at}
          />
        </div>
      );
    }

    return (
      <div className="flex h-full min-w-0 flex-col overflow-hidden bg-surface-card">
        <StationListTable<ReceivingLineRow>
          hideHeader
          loading={isLoading && rows.length === 0}
          isRefreshing={false}
          totalCount={rows.length}
          daySections={toDaySections(rows)}
          renderRow={renderRow}
          getRowKey={(row) => String(row.id)}
          virtualized
          emptyMessage="No tested lines yet — pass a unit to populate your history."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-surface-card">
      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading && rows.length === 0 ? (
          <div className="p-3">
            <SkeletonList count={12} type="row" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm font-semibold text-text-soft">
              No tested lines yet — pass a unit to populate your history.
            </p>
          </div>
        ) : (
          <div className="flex w-full flex-col">
            {rows.map((row, index) => (
              <ReceivingLineOrderRow
                key={row.id}
                row={row}
                index={index}
                isMobile={isMobile}
                selectMode={selectMode}
                isSelected={selectMode ? selectedIds.has(row.id) : false}
                onSelect={() => handleSelect(row)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
