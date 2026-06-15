'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { outboundOrderByIdQuery } from '@/lib/queries/outbound-queries';
import { UnshippedDetailsPanel } from '@/components/unshipped/UnshippedDetailsPanel';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { bustScanOutCaches } from '@/lib/outbound/outbound-cache-keys';

interface LabelsOrderWorkspaceProps {
  orderId: number;
  onClose: () => void;
}

/** Right-pane order detail for Labels mode (label attach lives in the Shipping tab). */
export function LabelsOrderWorkspace({ orderId, onClose }: LabelsOrderWorkspaceProps) {
  const queryClient = useQueryClient();
  const { data: order, isLoading, isError, refetch } = useQuery(outboundOrderByIdQuery(orderId));

  const handleUpdate = useCallback(() => {
    bustScanOutCaches(queryClient);
    void refetch();
  }, [queryClient, refetch]);

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white">
        <LoadingSpinner size="lg" className="text-violet-600" />
      </div>
    );
  }

  if (isError || !order) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-white px-8 text-center">
        <p className="text-sm font-semibold text-gray-700">Order not found</p>
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-bold text-violet-600 hover:underline"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <UnshippedDetailsPanel shipped={order} onClose={onClose} onUpdate={handleUpdate} />
  );
}
