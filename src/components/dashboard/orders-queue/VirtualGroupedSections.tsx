'use client';

import { useCallback, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { useVirtualizer, defaultRangeExtractor, type Range } from '@tanstack/react-virtual';
import { DateGroupHeader } from '@/components/ui/DateGroupHeader';
import { useAncestorScrollMargin } from '@/hooks/useAncestorScrollMargin';
import type { RowGroup } from '@/lib/group-rows';

/**
 * `VirtualGroupedSections<T>` — the generic, record-agnostic windowed renderer
 * for a date-banded list. It is the generalization of the ShippedOrder-only
 * {@link import('./VirtualQueueSections').VirtualQueueSections} (which now
 * delegates here) and the flat-list twin of `VirtualShippedSections`.
 *
 * A surface supplies EITHER folded order groups per day (`orderGroupsByDate`,
 * with a `renderGroup` that owns the singleton/multi-product collapse) OR a flat
 * `daySections` list (each day is just rows — testing history, station logs), and
 * a `renderRow`. Both shapes flatten into ONE linear item stream — a `header`
 * per day, then either `group` items or `row` items — handed to a single
 * `useVirtualizer`, so only the items intersecting the viewport (plus overscan)
 * are in the DOM regardless of list length.
 *
 * The scroll container is caller-owned (`scrollParentRef`). When embedded in a
 * stacked SwimlaneBoard lane that shares the board's single scroll region, pass
 * `useAncestorScroll` so the virtualizer offsets its window by this list's
 * position within that region (`scrollMargin`) — the Phase V0 fix, shared with
 * both virtual bodies via {@link useAncestorScrollMargin}.
 */

type FlatItem<T> =
  | { kind: 'header'; key: string; date: string; count: number }
  | { kind: 'group'; key: string; group: RowGroup<T>; baseStripeIndex: number }
  | { kind: 'row'; key: string; record: T; stripeIndex: number };

export interface VirtualGroupedSectionsProps<T> {
  /** Date bands → folded order groups (grouped mode). Mutually exclusive with
   *  `daySections`; pass a `renderGroup` alongside. */
  orderGroupsByDate?: [string, RowGroup<T>[]][];
  /** Date bands → flat rows (flat mode — testing history, station logs). */
  daySections?: [string, T[]][];
  /** The scrolling ancestor that owns the viewport (caller-owned). */
  scrollParentRef: RefObject<HTMLElement | null>;
  /** Render one row at the given zebra-stripe index. Used directly in flat mode
   *  and threaded into `renderGroup` in grouped mode. */
  renderRow: (record: T, stripeIndex: number) => ReactNode;
  /** Grouped mode: render one order group (singleton row or multi-product fold).
   *  Required when `orderGroupsByDate` is passed. */
  renderGroup?: (group: RowGroup<T>, baseStripeIndex: number) => ReactNode;
  /** Stable identity for a flat row (defaults to its index within the stream —
   *  pass a real id so windowing survives re-sorts without remounting). */
  getRowKey?: (record: T, dayIndex: number) => string;
  /** See {@link VirtualQueueSections}. Off (0 margin) → self-scrolling body. */
  useAncestorScroll?: boolean;
  /** First-paint size estimates; real heights measured on mount. */
  headerEstimate?: number;
  rowEstimate?: number;
  /** Row `getRowKey` value to scroll into view (deep-link / keyboard focus). The
   *  virtualizer scrolls to that item whenever this changes — works even when the
   *  target isn't currently windowed (unlike a DOM `scrollIntoView`). */
  scrollToKey?: string | null;
}

const HEADER_ESTIMATE = 36;
const ROW_ESTIMATE = 44;

export function VirtualGroupedSections<T>({
  orderGroupsByDate,
  daySections,
  scrollParentRef,
  renderRow,
  renderGroup,
  getRowKey,
  useAncestorScroll = false,
  headerEstimate = HEADER_ESTIMATE,
  rowEstimate = ROW_ESTIMATE,
  scrollToKey,
}: VirtualGroupedSectionsProps<T>) {
  const items = useMemo<FlatItem<T>[]>(() => {
    const flat: FlatItem<T>[] = [];
    if (orderGroupsByDate) {
      for (const [date, groups] of orderGroupsByDate) {
        const dayTotal = groups.reduce((sum, g) => sum + g.rows.length, 0);
        flat.push({ kind: 'header', key: `h:${date}`, date, count: dayTotal });
        // `baseStripeIndex` runs across the whole day (group children included)
        // so zebra striping matches the dense section exactly.
        let stripeIndex = 0;
        for (const group of groups) {
          flat.push({ kind: 'group', key: `g:${date}:${group.key}`, group, baseStripeIndex: stripeIndex });
          stripeIndex += group.rows.length;
        }
      }
    } else if (daySections) {
      for (const [date, rows] of daySections) {
        flat.push({ kind: 'header', key: `h:${date}`, date, count: rows.length });
        rows.forEach((record, dayIndex) => {
          const key = getRowKey ? `r:${getRowKey(record, dayIndex)}` : `r:${date}:${dayIndex}`;
          flat.push({ kind: 'row', key, record, stripeIndex: dayIndex });
        });
      }
    }
    return flat;
  }, [orderGroupsByDate, daySections, getRowKey]);

  // Indices of the day-band headers — candidates for the sticky pin.
  const stickyIndexes = useMemo(
    () => items.reduce<number[]>((acc, it, i) => (it.kind === 'header' ? (acc.push(i), acc) : acc), []),
    [items],
  );

  // The header currently pinned to the top of the viewport, updated inside
  // `rangeExtractor` (runs on every scroll) so the visible day's label stays stuck.
  const activeStickyIndexRef = useRef(0);

  // Stacked-lane case: window against a shared ancestor scroll region (see V0).
  const innerRef = useRef<HTMLDivElement>(null);
  const scrollMargin = useAncestorScrollMargin({
    enabled: useAncestorScroll,
    scrollParentRef,
    innerRef,
    deps: [items],
  });

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: (index) => (items[index].kind === 'header' ? headerEstimate : rowEstimate),
    overscan: 10,
    getItemKey: (index) => items[index].key,
    rangeExtractor: useCallback(
      (range: Range) => {
        const active = [...stickyIndexes].reverse().find((i) => range.startIndex >= i) ?? 0;
        activeStickyIndexRef.current = active;
        const next = new Set([active, ...defaultRangeExtractor(range)]);
        return [...next].sort((a, b) => a - b);
      },
      [stickyIndexes],
    ),
    scrollMargin,
  });

  // Deep-link / keyboard focus: scroll the target row into view even when it is
  // outside the current window (DOM scrollIntoView can't reach an unmounted row).
  useEffect(() => {
    if (!scrollToKey) return;
    const idx = items.findIndex((it) => it.key === `r:${scrollToKey}`);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'center' });
    // Intentionally keyed on `scrollToKey` only — scroll on focus/deep-link change,
    // not on every data re-render (which would fight the user's scroll position).
  }, [scrollToKey]);

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div ref={innerRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
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
            // is absolutely positioned by the virtualizer transform. When embedded
            // in a shared ancestor scroll region, subtract `scrollMargin` to lay out
            // within this list's own wrapper (start is measured from the region top).
            className={`left-0 top-0 w-full ${pinned ? 'z-20' : header ? 'z-10' : 'z-0'}`}
            style={
              pinned
                ? { position: 'sticky', top: 0 }
                : { position: 'absolute', transform: `translateY(${vRow.start - scrollMargin}px)` }
            }
          >
            {item.kind === 'header' ? (
              <DateGroupHeader date={item.date} total={item.count} sticky={false} />
            ) : item.kind === 'group' ? (
              renderGroup?.(item.group, item.baseStripeIndex) ?? null
            ) : (
              renderRow(item.record, item.stripeIndex)
            )}
          </div>
        );
      })}
    </div>
  );
}
