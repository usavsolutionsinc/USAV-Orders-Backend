'use client';

import { useCallback, type ReactNode, type RefObject } from 'react';
import { VirtualGroupedSections } from './VirtualGroupedSections';
import { QueueGroupRow } from './QueueGroupRow';
import type { RowGroup } from '@/lib/group-rows';
import type { ShippedOrder } from '@/lib/neon/orders-queries';

/**
 * Windowed renderer for the date-banded orders queue — now a thin, ShippedOrder-
 * typed wrapper over the generic {@link VirtualGroupedSections}. It supplies the
 * queue's group renderer ({@link QueueGroupRow}, which folds multi-product orders
 * into a collapsible header) and threads `renderRow` straight through, so the
 * dense table and the windowed lane body render groups from ONE source with no
 * duplicate markup. All windowing / sticky-header / ancestor-scroll mechanics
 * live in the generic component; this file is just the queue's binding.
 */

export interface VirtualQueueSectionsProps {
  /** Date bands → folded order groups, in canonical render order. */
  orderGroupsByDate: [string, RowGroup<ShippedOrder>[]][];
  /** The scrolling ancestor that owns the viewport (caller-owned). */
  scrollParentRef: RefObject<HTMLElement | null>;
  isMobile: boolean;
  /** Render a single queue row at the given zebra-stripe index (shared with the
   *  dense table so tester/packer + flags resolve identically). */
  renderRow: (record: ShippedOrder, stripeIndex: number) => ReactNode;
  /** When the `scrollParentRef` is an ANCESTOR shared with sibling lists (a
   *  stacked SwimlaneBoard lane sharing the board's single scroll region) rather
   *  than this list's own scroll body, offset the virtualizer window by how far
   *  this list sits below the scroll region's content top (`scrollMargin`) and
   *  position rows `translateY(start - scrollMargin)`. Off (0 margin) for the
   *  self-scrolling body case, keeping that path byte-identical. */
  useAncestorScroll?: boolean;
}

export function VirtualQueueSections({
  orderGroupsByDate,
  scrollParentRef,
  isMobile,
  renderRow,
  useAncestorScroll = false,
}: VirtualQueueSectionsProps) {
  const renderGroup = useCallback(
    (group: RowGroup<ShippedOrder>, baseStripeIndex: number) => (
      <QueueGroupRow group={group} baseStripeIndex={baseStripeIndex} isMobile={isMobile} renderRow={renderRow} />
    ),
    [isMobile, renderRow],
  );

  return (
    <VirtualGroupedSections<ShippedOrder>
      orderGroupsByDate={orderGroupsByDate}
      scrollParentRef={scrollParentRef}
      renderRow={renderRow}
      renderGroup={renderGroup}
      useAncestorScroll={useAncestorScroll}
    />
  );
}
