'use client';

/**
 * ShippedLaneTable — the rows-only, embeddable body of the Shipped table, sized
 * to its content. It is to the Shipped board what the `autoHeight` mode of
 * `OrdersQueueTable` is to the Unshipped board: given ONE lane's bucket of
 * already-derived records, it day-bands them ({@link useShippedTableGrouping})
 * and renders the same windowed rows the dense table uses (via
 * {@link VirtualShippedSections}), with slim `chip` date headers and
 * vertical-only scroll capped by the lane's drag-resized height. It owns no
 * fetch, no header, no selection state — the board passes those in, so every
 * lane shares one fetch + one selection model.
 */

import { useRef, type RefObject } from 'react';
import { SkeletonList } from '@/design-system';
import { VirtualShippedSections } from '@/components/shipped/dashboard-table/VirtualShippedSections';
import { useShippedTableGrouping } from '@/components/shipped/dashboard-table/useShippedTableGrouping';
import type { DerivedPackerRecord } from '@/lib/shipped-records';

interface ShippedLaneTableProps {
  /** This lane's bucket (records whose outboundState maps to the lane). */
  records: DerivedPackerRecord[];
  loading: boolean;
  isMobile: boolean;
  selectMode: boolean;
  selectedIds: ReadonlySet<number>;
  selectedDetailId: number | null;
  onRowClick: (record: DerivedPackerRecord) => void;
  onToggle: (id: number, shiftKey: boolean) => void;
  /** Tailwind max-height utility for the body when no drag-resize px is set. */
  maxBodyHeightClass?: string;
  /** Explicit px cap from a drag-resize; wins over `maxBodyHeightClass`. */
  maxBodyHeightPx?: number;
  /** Stacked (1-up) lanes: grow to content with NO internal scroll/cap so the
   *  board owns the single scroll region (matches OrdersQueueTable). */
  growToContent?: boolean;
  /** Stacked (1-up) lanes only: the board's shared scroll region. When set, the
   *  virtualizer windows against it (instead of this lane's absent scroll body),
   *  so a stacked lane stays windowed rather than mounting every row (Phase V0). */
  scrollParentRef?: RefObject<HTMLElement | null>;
  /** Shown (faint, italic) when this lane has no records. */
  emptyMessage: string;
}

export function ShippedLaneTable({
  records,
  loading,
  isMobile,
  selectMode,
  selectedIds,
  selectedDetailId,
  onRowClick,
  onToggle,
  maxBodyHeightClass,
  maxBodyHeightPx,
  growToContent = false,
  scrollParentRef,
  emptyMessage,
}: ShippedLaneTableProps) {
  const { daySections } = useShippedTableGrouping(records);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Vertical-only, content-sized up to a cap (px wins over class) — matches the
  // `autoHeight` body of OrdersQueueTable so the two boards scroll identically.
  // `growToContent` (stacked lanes) drops the inner scroll/cap entirely so the
  // board's single scroll region owns the wheel (no per-lane scroll trap).
  const bodyClass = growToContent
    ? 'overflow-x-clip w-full'
    : `overflow-x-hidden overflow-y-auto no-scrollbar w-full ${
        maxBodyHeightPx == null ? maxBodyHeightClass ?? '' : ''
      }`;
  const bodyStyle = !growToContent && maxBodyHeightPx != null ? { maxHeight: maxBodyHeightPx } : undefined;

  if (loading) {
    return (
      <div className={bodyClass} style={bodyStyle}>
        <SkeletonList count={6} />
      </div>
    );
  }

  if (daySections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <p className="text-text-soft font-semibold italic opacity-20">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div ref={bodyRef} className={bodyClass} style={bodyStyle}>
      <div className="w-full px-2 pb-6">
        <VirtualShippedSections
          daySections={daySections}
          // Stacked lane: window against the board's shared scroll region.
          // Otherwise this lane's own capped body owns the scroll.
          scrollParentRef={scrollParentRef ?? bodyRef}
          useAncestorScroll={Boolean(scrollParentRef)}
          isMobile={isMobile}
          selectMode={selectMode}
          selectedIds={selectedIds}
          selectedDetailId={selectedDetailId}
          onRowClick={onRowClick}
          onToggle={onToggle}
        />
      </div>
    </div>
  );
}
