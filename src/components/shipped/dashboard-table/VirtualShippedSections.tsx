'use client';

import { useCallback, useMemo, useRef, type RefObject } from 'react';
import { useVirtualizer, defaultRangeExtractor, type Range } from '@tanstack/react-virtual';
import { DateGroupHeader } from '@/components/ui/DateGroupHeader';
import { ShippedRecordRow } from '@/components/shipped/ShippedRecordRow';
import { getDetailId } from '@/components/shipped/shipped-record-mappers';
import type { DerivedPackerRecord } from '@/lib/shipped-records';

/** One day band: `[dateKey, records]` — matches `useShippedTableGrouping`. */
type ShippedDaySection = [string, DerivedPackerRecord[]];

/**
 * Windowed renderer for the day-banded shipped list.
 *
 * The day sections are flattened into ONE linear item stream — a `header` item
 * per day followed by its `row` items — and handed to a single
 * `useVirtualizer`. Only the rows intersecting the scroll viewport (plus a small
 * overscan) are in the DOM, so the table's DOM size stays constant whether the
 * window holds 50 rows or several thousand merged across week buckets. This
 * replaces the prior `daySections.map(... records.map(...))` that mounted every
 * row at once.
 *
 * The scroll container is owned by the CALLER (the dashboard body / lane body)
 * and passed in via `scrollParentRef`, so existing scroll-reset and drag-resize
 * behavior is preserved; this component only measures + positions rows inside
 * it. Row heights vary (chips wrap, mobile vs desktop), so heights are measured
 * dynamically via `measureElement` rather than assumed fixed.
 */

type FlatItem =
  | { kind: 'header'; key: string; date: string; count: number }
  | { kind: 'row'; key: string; record: DerivedPackerRecord; dayIndex: number };

export interface VirtualShippedSectionsProps {
  daySections: ShippedDaySection[];
  /** The scrolling ancestor that owns the viewport (caller-owned). */
  scrollParentRef: RefObject<HTMLElement | null>;
  isMobile: boolean;
  selectMode: boolean;
  selectedIds: ReadonlySet<number>;
  selectedDetailId: number | null;
  onRowClick: (record: DerivedPackerRecord) => void;
  onToggle: (id: number, shiftKey: boolean) => void;
}

/** Rough first-paint estimates; real heights are measured on mount. */
const HEADER_ESTIMATE = 28;
const ROW_ESTIMATE = 44;

export function VirtualShippedSections({
  daySections,
  scrollParentRef,
  isMobile,
  selectMode,
  selectedIds,
  selectedDetailId,
  onRowClick,
  onToggle,
}: VirtualShippedSectionsProps) {
  const items = useMemo<FlatItem[]>(() => {
    const flat: FlatItem[] = [];
    for (const [date, records] of daySections) {
      flat.push({ kind: 'header', key: `h:${date}`, date, count: records.length });
      records.forEach((record, dayIndex) => {
        flat.push({ kind: 'row', key: `r:${String(record.id)}`, record, dayIndex });
      });
    }
    return flat;
  }, [daySections]);

  // Indices of the day-band headers — candidates for the sticky pin.
  const stickyIndexes = useMemo(
    () => items.reduce<number[]>((acc, it, i) => (it.kind === 'header' ? (acc.push(i), acc) : acc), []),
    [items],
  );

  const innerRef = useRef<HTMLDivElement>(null);
  // The header currently pinned to the top of the viewport. Updated inside
  // `rangeExtractor` (which runs on every scroll) to the last header at or above
  // the scroll offset, so the visible day's label stays stuck while its rows scroll.
  const activeStickyIndexRef = useRef(0);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: (index) => (items[index].kind === 'header' ? HEADER_ESTIMATE : ROW_ESTIMATE),
    overscan: 10,
    // Stable identity so windowing survives re-sorts/dedupe without remounting
    // the wrong row into a measured slot.
    getItemKey: (index) => items[index].key,
    // Always keep the active day header in the rendered set so it can pin to the
    // top even when its real position has scrolled out of the window.
    rangeExtractor: useCallback(
      (range: Range) => {
        const active = [...stickyIndexes].reverse().find((i) => range.startIndex >= i) ?? 0;
        activeStickyIndexRef.current = active;
        const next = new Set([active, ...defaultRangeExtractor(range)]);
        return [...next].sort((a, b) => a - b);
      },
      [stickyIndexes],
    ),
  });

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div
      ref={innerRef}
      className="relative w-full"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualRows.map((vRow) => {
        const item = items[vRow.index];
        const header = item.kind === 'header';
        const pinned = header && activeStickyIndexRef.current === vRow.index;
        return (
          <div
            key={vRow.key}
            data-index={vRow.index}
            ref={virtualizer.measureElement}
            // The active header pins via position:sticky (top:0); every other item
            // is absolutely positioned by the virtualizer transform. No full-bleed
            // background — the pill inside DateGroupHeader is the only chrome (same
            // as ReceivingGroupedList / other day-banded tables).
            className={`left-0 top-0 w-full ${pinned ? 'z-20' : header ? 'z-10' : 'z-0'}`}
            style={
              pinned
                ? { position: 'sticky', top: 0 }
                : { position: 'absolute', transform: `translateY(${vRow.start}px)` }
            }
          >
            {header ? (
              <DateGroupHeader date={item.date} total={item.count} sticky={false} />
            ) : (
              <ShippedRecordRow
                record={item.record}
                index={item.dayIndex}
                isMobile={isMobile}
                selectMode={selectMode}
                checked={selectMode && selectedIds.has(Number(item.record.id))}
                selected={selectedDetailId === getDetailId(item.record)}
                onRowClick={onRowClick}
                onToggle={onToggle}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
