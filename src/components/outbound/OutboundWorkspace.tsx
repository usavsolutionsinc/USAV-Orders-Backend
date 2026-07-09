'use client';

import { useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { outboundOrderByIdQuery } from '@/lib/queries/outbound-queries';
import { LabelsOrderWorkspace } from '@/components/outbound/labels/LabelsOrderWorkspace';
import { LabelsQueueTable } from '@/components/outbound/labels/LabelsQueueTable';
import { OutboundDocumentsPrintView } from '@/components/outbound/labels/OutboundDocumentsPrintView';
import { StagedQueueTable } from '@/components/outbound/scan-out/StagedQueueTable';
import { ShippedDetailsPanel } from '@/components/shipped/ShippedDetailsPanel';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useOutboundUrlState } from '@/hooks/useOutboundUrlState';
import { bustScanOutCaches } from '@/lib/outbound/outbound-cache-keys';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { useMotionPresence, useMotionTransition } from '@/design-system/foundations/motion-framer-hooks';
import type { ShippedOrder } from '@/lib/neon/orders-queries';

function StagedOrderDetail({
  orderId,
  onClose,
}: {
  orderId: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: order, isLoading, isError, refetch } = useQuery(outboundOrderByIdQuery(orderId));

  const handleUpdate = useCallback(() => {
    bustScanOutCaches(queryClient);
    void refetch();
  }, [queryClient, refetch]);

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface-card">
        <LoadingSpinner size="lg" className="text-emerald-600" />
      </div>
    );
  }

  if (isError || !order) return null;

  return (
    <ShippedDetailsPanel
      shipped={order}
      onClose={onClose}
      onUpdate={handleUpdate}
      context="staged"
    />
  );
}

export function OutboundWorkspace() {
  const { mode, open, q, sort, setOpen } = useOutboundUrlState();

  const handleOpenOrder = useCallback(
    (order: ShippedOrder) => setOpen(Number(order.id)),
    [setOpen],
  );

  const handleCloseDetail = useCallback(() => setOpen(null), [setOpen]);

  // Labels mode: the main pane alternates between the queue list and the
  // selected order's document print view (docs/outbound-documents-plan.md
  // Phase 2) — a singular crossfade target, keyed on which "mode" the pane is
  // in, per the house motion law. The side panel (attach/fetch/delete tray,
  // under its own Documents tab) still opens independently over the top.
  const paneMotionProps = {
    ...useMotionPresence(framerPresence.workbenchPane),
    transition: useMotionTransition(framerTransition.workbenchPaneMount),
  };

  return (
    <div className="relative flex h-full min-w-0 flex-1 overflow-hidden">
      {mode === 'scan-out' ? (
        <StagedQueueTable
          searchQuery={q}
          onOpenOrder={handleOpenOrder}
          onCloseOrder={handleCloseDetail}
        />
      ) : (
        <div className="relative flex h-full min-w-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            {open ? (
              <motion.div key={`documents-${open}`} {...paneMotionProps} className="flex h-full min-w-0 flex-1">
                <OutboundDocumentsPrintView orderId={open} />
              </motion.div>
            ) : (
              <motion.div key="queue" {...paneMotionProps} className="flex h-full min-w-0 flex-1">
                <LabelsQueueTable
                  searchQuery={q}
                  sort={sort}
                  onOpenOrder={handleOpenOrder}
                  onCloseOrder={handleCloseDetail}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {open ? (
          mode === 'labels' ? (
            <LabelsOrderWorkspace key={open} orderId={open} onClose={handleCloseDetail} />
          ) : (
            <StagedOrderDetail key={open} orderId={open} onClose={handleCloseDetail} />
          )
        ) : null}
      </AnimatePresence>
    </div>
  );
}
