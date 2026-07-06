'use client';

import { useCallback, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { useVirtualizer, defaultRangeExtractor, type Range } from '@tanstack/react-virtual';
import { DateGroupHeader } from '@/components/ui/DateGroupHeader';
import { QueueGroupRow } from './QueueGroupRow';
import type { RowGroup } from '@/lib/group-rows';
import type { ShippedOrder } from '@/lib/neon/orders-queries';

/**
 * Windowed renderer for the date-banded orders queue — the Unshipped-side twin of
 * {@link VirtualShippedSections}. The day bands (`orderGroupsByDate` from
 * {@link useOrdersQueueRows}) are flattened into ONE linear item stream — a
 * `header` per day followed by one `group` item per folded order — and handed to
 * a single `useVirtualizer`. Only the items intersecting the viewport (plus a
 * small overscan) are in the DOM, so a lane's DOM size stays constant whether it
 * holds 30 rows or several thousand, replacing the prior
 * `orderGroupsByDate.map(QueueDateSection)` that mounted every row at once.
 *
 * The scroll container is owned by the CALLER (`OrdersQueueTable`'s body) and
 * passed via `scrollParentRef`, so scroll-reset / drag-resize behavior is
 * preserved; this component only measures + positions items inside it. Heights
 * vary (chips wrap, a multi-product group expands), so each item is measured
 * dynamically via `measureElement` (ResizeObserver) rather than assumed fixed —
 * an expand/collapse just re-measures its group item in place.
 *
 * Group rendering is delegated to the shared {@link QueueGroupRow}, the SAME
 * component the dense table uses, so there is no duplicate row/group markup and
 * the two paths stay pixel-identical. `renderRow` is threaded straight through.
 */

type FlatItem =
  | { kind: 'header'; key: string; date: string; count: number }
  | { kind: 'group'; key: string; group: RowGroup<ShippedOrder>; baseStripeIndex: number };

export interface VirtualQueueSectionsProps {
  /** Date bands → folded order groups, in canonical render order. */
  orderGroupsByDate: [string, RowGroup<ShippedOrder>[]][];
  /** The scrolling ancestor that owns the viewport (caller-owned). */
  scrollParentRef: RefObject<HTMLElement | null>;
  isMobile: boolean;
  /** Render a single queue row at the given zebra-stripe index (shared with the
   *  dense table so tester/packer + flags resolve identically). */
  renderRow: (record: ShippedOrder, stripeIndex: number) => ReactNode;
}

/** Rough first-paint estimates; real heights are measured on mount. */
const HEADER_ESTIMATE = 36;
const ROW_ESTIMATE = 44;

export function VirtualQueueSections({
  orderGroupsByDate,
  scrollParentRef,
  isMobile,
  renderRow,
}: VirtualQueueSectionsProps) {
  const items = useMemo<FlatItem[]>(() => {
    const flat: FlatItem[] = [];
    for (const [date, groups] of orderGroupsByDate) {
      const dayTotal = groups.reduce((sum, g) => sum + g.rows.length, 0);
      flat.push({ kind: 'header', key: `h:${date}`, date, count: dayTotal });
      // `baseStripeIndex` runs across the whole day (group children included) so
      // zebra striping matches the dense QueueDateSection exactly.
      let stripeIndex = 0;
      for (const group of groups) {
        flat.push({ kind: 'group', key: `g:${date}:${group.key}`, group, baseStripeIndex: stripeIndex });
        stripeIndex += group.rows.length;
      }
    }
    return flat;
  }, [orderGroupsByDate]);

  // Indices of the day-band headers — candidates for the sticky pin.
  const stickyIndexes = useMemo(
    () => items.reduce<number[]>((acc, it, i) => (it.kind === 'header' ? (acc.push(i), acc) : acc), []),
    [items],
  );

  // The header currently pinned to the top of the viewport. Updated inside
  // `rangeExtractor` (runs on every scroll) to the last header at or above the
  // scroll offset, so the visible day's label stays stuck while its rows scroll.
  const activeStickyIndexRef = useRef(0);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: (index) => (items[index].kind === 'header' ? HEADER_ESTIMATE : ROW_ESTIMATE),
    overscan: 10,
    // Stable identity so windowing survives re-sorts/dedupe without remounting
    // the wrong item into a measured slot.
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
    <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
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
            // is absolutely positioned by the virtualizer transform. The pill
            // inside DateGroupHeader is the only chrome (matches VirtualShippedSections).
            className={`left-0 top-0 w-full ${pinned ? 'z-20' : header ? 'z-10' : 'z-0'}`}
            style={
              pinned
                ? { position: 'sticky', top: 0 }
                : { position: 'absolute', transform: `translateY(${vRow.start}px)` }
            }
          >
            {item.kind === 'header' ? (
              <DateGroupHeader date={item.date} total={item.count} sticky={false} />
            ) : (
              <QueueGroupRow
                group={item.group}
                baseStripeIndex={item.baseStripeIndex}
                isMobile={isMobile}
                renderRow={renderRow}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
