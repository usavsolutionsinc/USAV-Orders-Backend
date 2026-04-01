'use client';

import { useEffect, useRef, useState } from 'react';
import { useDeleteOrderRow } from '@/hooks';

interface DeleteOrderControlProps {
  orderId: number;
  packerLogId?: number | null;
  stationActivityLogId?: number | null;
  trackingType?: string | null;
  onDeleted: () => void;
}

export function DeleteOrderControl({
  orderId,
  packerLogId,
  stationActivityLogId,
  trackingType,
  onDeleted,
}: DeleteOrderControlProps) {
  const [isDeleteArmed, setIsDeleteArmed] = useState(false);
  const deleteArmTimeoutRef = useRef<number | null>(null);
  const deleteOrderMutation = useDeleteOrderRow();

  useEffect(() => {
    return () => {
      if (deleteArmTimeoutRef.current) window.clearTimeout(deleteArmTimeoutRef.current);
    };
  }, []);

  const handleDelete = async () => {
    if (!isDeleteArmed) {
      setIsDeleteArmed(true);
      if (deleteArmTimeoutRef.current) window.clearTimeout(deleteArmTimeoutRef.current);
      deleteArmTimeoutRef.current = window.setTimeout(() => setIsDeleteArmed(false), 3000);
      return;
    }
    if (deleteArmTimeoutRef.current) {
      window.clearTimeout(deleteArmTimeoutRef.current);
      deleteArmTimeoutRef.current = null;
    }
    setIsDeleteArmed(false);
    try {
      const normalizedTrackingType = String(trackingType || '').toUpperCase();
      const isLikelyActivityLogRow =
        stationActivityLogId != null && Number(stationActivityLogId) === Number(orderId);
      const shouldDeletePackingLog =
        normalizedTrackingType === 'FBA' ||
        normalizedTrackingType === 'FNSKU' ||
        normalizedTrackingType === 'SKU' ||
        normalizedTrackingType === 'SCAN' ||
        isLikelyActivityLogRow;

      if (shouldDeletePackingLog && (stationActivityLogId != null || packerLogId != null)) {
        await deleteOrderMutation.mutateAsync({
          rowSource: 'packing_log',
          activityLogId: stationActivityLogId ?? undefined,
          packerLogId: packerLogId ?? undefined,
        });
      } else {
        await deleteOrderMutation.mutateAsync({ rowSource: 'order', orderId });
      }
      onDeleted();
    } catch (error) {
      console.error('Failed to permanently delete order:', error);
      window.alert('Failed to permanently delete order. Please try again.');
    }
  };

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleteOrderMutation.isPending}
      className="w-full h-10 inline-flex items-center justify-center rounded-xl bg-red-600 hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
    >
      {deleteOrderMutation.isPending ? 'Deleting...' : isDeleteArmed ? 'Click Again To Confirm' : 'Delete Permanently'}
    </button>
  );
}
