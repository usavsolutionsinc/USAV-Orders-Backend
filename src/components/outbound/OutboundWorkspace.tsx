'use client';

import { useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { outboundOrderByIdQuery } from '@/lib/queries/outbound-queries';
import { LabelsOrderWorkspace } from '@/components/outbound/labels/LabelsOrderWorkspace';
import { LabelsQueueTable } from '@/components/outbound/labels/LabelsQueueTable';
import { StagedQueueTable } from '@/components/outbound/scan-out/StagedQueueTable';
import { UnshippedDetailsPanel } from '@/components/unshipped/UnshippedDetailsPanel';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useOutboundUrlState } from '@/hooks/useOutboundUrlState';
import { bustScanOutCaches } from '@/lib/outbound/outbound-cache-keys';
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
      <div className="flex h-full w-full items-center justify-center bg-white">
        <LoadingSpinner size="lg" className="text-emerald-600" />
      </div>
    );
  }

  if (isError || !order) return null;

  return <UnshippedDetailsPanel shipped={order} onClose={onClose} onUpdate={handleUpdate} />;
}

export function OutboundWorkspace() {
  const { mode, open, q, sort, setOpen } = useOutboundUrlState();

  const handleOpenOrder = useCallback(
    (order: ShippedOrder) => setOpen(Number(order.id)),
    [setOpen],
  );

  const handleCloseDetail = useCallback(() => setOpen(null), [setOpen]);

  return (
    <div className="relative flex h-full min-w-0 flex-1 overflow-hidden">
      {mode === 'scan-out' ? (
        <StagedQueueTable
          searchQuery={q}
          onOpenOrder={handleOpenOrder}
          onCloseOrder={handleCloseDetail}
        />
      ) : (
        <LabelsQueueTable
          searchQuery={q}
          sort={sort}
          onOpenOrder={handleOpenOrder}
          onCloseOrder={handleCloseDetail}
        />
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
