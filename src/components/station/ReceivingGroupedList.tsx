'use client';

/**
 * Renders the day-banded, PO-grouped receiving feed: each PST day band lists its
 * PO groups; a single-line PO renders flat, a multi-line PO renders a collapsed
 * {@link ReceivingPoSummary} that expands to its child {@link ReceivingLineOrderRow}s.
 * Pure presentational — selection + data come from the table's hooks. Extracted
 * from ReceivingLinesTable; behaviour is unchanged.
 */

import { CollapsibleGroupRow } from '@/components/ui/CollapsibleGroupRow';
import { DateGroupHeader } from '@/components/ui/DateGroupHeader';
import { poGroupAnchorMs, type ReceivingPoGroup } from '@/components/station/receiving-lines-table-helpers';
import { ReceivingLineOrderRow } from '@/components/station/ReceivingLineOrderRow';
import { ReceivingPoSummary } from '@/components/station/ReceivingPoSummary';
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
}: ReceivingGroupedListProps) {
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
