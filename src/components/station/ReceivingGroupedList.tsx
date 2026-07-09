'use client';

/**
 * Renders the day-banded, PO-grouped receiving feed: each PST day band lists its
 * PO groups; a single-line PO renders flat, a multi-line PO renders a collapsed
 * {@link ReceivingPoSummary} that expands to its child {@link ReceivingLineOrderRow}s.
 * Pure presentational — selection + data come from the table's hooks. Extracted
 * from ReceivingLinesTable; behaviour is unchanged.
 */

import { type ReactNode, type RefObject } from 'react';
import { CollapsibleGroupRow } from '@/components/ui/CollapsibleGroupRow';
import { DateGroupHeader } from '@/components/ui/DateGroupHeader';
import { poGroupAnchorMs, type ReceivingPoGroup } from '@/components/station/receiving-lines-table-helpers';
import { ReceivingLineOrderRow } from '@/components/station/ReceivingLineOrderRow';
import { ReceivingPoSummary } from '@/components/station/ReceivingPoSummary';
import { VirtualGroupedSections } from '@/components/dashboard/orders-queue/VirtualGroupedSections';
import type { RowGroup } from '@/lib/group-rows';
import type { ReceivingLineRow } from './receiving-line-row';

interface ReceivingGroupedListProps {
  filteredGroupedRecords: Record<string, ReceivingPoGroup[]>;
  /** When true (Incoming) keep the server ORDER BY; otherwise sort by activity. */
  serverSorted: boolean;
  isMobile: boolean;
  isIncomingMode: boolean;
  isHistoryMode: boolean;
  selectMode: boolean;
  selectedId: number | null;
  selectedIds: Set<number>;
  handleSelectRow: (row: ReceivingLineRow) => void;
  /** Window the PO-grouped body (behind `NEXT_PUBLIC_STATION_VIRTUAL_LIST`), so the
   *  DOM stays ∝ viewport. Requires `scrollParentRef` (the table's scroll body). */
  virtualized?: boolean;
  scrollParentRef?: RefObject<HTMLElement | null>;
}

export function ReceivingGroupedList({
  filteredGroupedRecords,
  serverSorted,
  isMobile,
  isIncomingMode,
  isHistoryMode,
  selectMode,
  selectedId,
  selectedIds,
  handleSelectRow,
  virtualized = false,
  scrollParentRef,
}: ReceivingGroupedListProps) {
  // One PO group → a flat row (singleton) or a collapsible multi-line summary.
  // Shared by the dense map AND the windowed body so there's no duplicate markup.
  const renderPoGroup = (group: RowGroup<ReceivingLineRow>, baseIndex: number): ReactNode => {
    if (group.rows.length === 1) {
      const row = group.rows[0];
      return (
        <ReceivingLineOrderRow
          key={row.id}
          row={row}
          index={baseIndex}
          isMobile={isMobile}
          isIncoming={isIncomingMode}
          isHistory={isHistoryMode}
          selectMode={selectMode}
          isSelected={selectMode ? selectedIds.has(row.id) : selectedId === row.id}
          onSelect={() => handleSelectRow(row)}
        />
      );
    }
    const hasSelected = group.rows.some((r) => (selectMode ? selectedIds.has(r.id) : selectedId === r.id));
    return (
      <CollapsibleGroupRow
        key={group.key}
        index={baseIndex}
        showChevron={false}
        defaultExpanded={selectMode || hasSelected}
        summary={<ReceivingPoSummary rows={group.rows} isMobile={isMobile} isIncoming={isIncomingMode} isHistory={isHistoryMode} />}
      >
        {group.rows.map((row, lineIndex) => (
          <ReceivingLineOrderRow
            key={row.id}
            row={row}
            index={lineIndex}
            isMobile={isMobile}
            isIncoming={isIncomingMode}
            isHistory={isHistoryMode}
            selectMode={selectMode}
            isSelected={selectMode ? selectedIds.has(row.id) : selectedId === row.id}
            onSelect={() => handleSelectRow(row)}
          />
        ))}
      </CollapsibleGroupRow>
    );
  };

  // Windowed path: flatten the day bands into RowGroups and hand them to the
  // shared VirtualGroupedSections (self-scrolling body → no ancestor margin).
  if (virtualized && scrollParentRef) {
    const orderGroupsByDate: [string, RowGroup<ReceivingLineRow>[]][] = Object.entries(filteredGroupedRecords)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, dayGroups]) => {
        const sorted = serverSorted ? dayGroups : [...dayGroups].sort((a, b) => poGroupAnchorMs(b) - poGroupAnchorMs(a));
        return [date, sorted];
      });
    return (
      <VirtualGroupedSections<ReceivingLineRow>
        orderGroupsByDate={orderGroupsByDate}
        scrollParentRef={scrollParentRef}
        renderGroup={(group, baseStripeIndex) => renderPoGroup(group, baseStripeIndex)}
        renderRow={(row, index) => renderPoGroup({ key: `k:${row.id}`, rows: [row] }, index)}
      />
    );
  }

  return (
    <div className="flex w-full flex-col">
      {Object.entries(filteredGroupedRecords)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([date, dayGroups]) => {
          // Preserve server ORDER BY for incoming (the Sort control already
          // drives it); other modes re-sort groups by activity.
          const sortedGroups = serverSorted
            ? dayGroups
            : [...dayGroups].sort((a, b) => poGroupAnchorMs(b) - poGroupAnchorMs(a));
          return (
            <div key={date} className="flex flex-col">
              <DateGroupHeader date={date} total={sortedGroups.length} />
              {sortedGroups.map((group, groupIndex) => {
                // Single-line PO → render flat; no chevron noise.
                if (group.rows.length === 1) {
                  const row = group.rows[0];
                  return (
                    <ReceivingLineOrderRow
                      key={row.id}
                      row={row}
                      index={groupIndex}
                      isMobile={isMobile}
                      isIncoming={isIncomingMode}
                      isHistory={isHistoryMode}
                      selectMode={selectMode}
                      isSelected={selectMode ? selectedIds.has(row.id) : selectedId === row.id}
                      onSelect={() => handleSelectRow(row)}
                    />
                  );
                }
                // Multi-line PO → one collapsed summary; expand to reveal lines.
                // Auto-open in select mode (so lines are reachable) or when a
                // child is the active row.
                const hasSelected = group.rows.some((r) =>
                  selectMode ? selectedIds.has(r.id) : selectedId === r.id,
                );
                return (
                  <CollapsibleGroupRow
                    key={group.key}
                    index={groupIndex}
                    showChevron={false}
                    defaultExpanded={selectMode || hasSelected}
                    summary={
                      <ReceivingPoSummary
                        rows={group.rows}
                        isMobile={isMobile}
                        isIncoming={isIncomingMode}
                        isHistory={isHistoryMode}
                      />
                    }
                  >
                    {group.rows.map((row, lineIndex) => (
                      <ReceivingLineOrderRow
                        key={row.id}
                        row={row}
                        index={lineIndex}
                        isMobile={isMobile}
                        isIncoming={isIncomingMode}
                        isHistory={isHistoryMode}
                        selectMode={selectMode}
                        isSelected={selectMode ? selectedIds.has(row.id) : selectedId === row.id}
                        onSelect={() => handleSelectRow(row)}
                      />
                    ))}
                  </CollapsibleGroupRow>
                );
              })}
            </div>
          );
        })}
    </div>
  );
}
