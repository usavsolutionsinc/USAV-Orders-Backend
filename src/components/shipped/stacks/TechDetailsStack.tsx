'use client';

import { useEffect, useRef, useState } from 'react';
import { Trash2 } from '@/components/Icons';
import { DetailsStackProps } from './types';
import { ShippedDetailsPanelContent } from '../ShippedDetailsPanelContent';
import { dispatchCloseShippedDetails, dispatchDashboardAndStationRefresh } from '@/utils/events';

export function TechDetailsStack({
  shipped,
  durationData,
  copiedAll,
  onCopyAll,
  onUpdate
}: DetailsStackProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleteArmed, setIsDeleteArmed] = useState(false);
  const deleteArmTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (deleteArmTimeoutRef.current) {
        window.clearTimeout(deleteArmTimeoutRef.current);
      }
    };
  }, []);

  const deleteTechOrder = async () => {
    if (!isDeleteArmed) {
      setIsDeleteArmed(true);
      if (deleteArmTimeoutRef.current) {
        window.clearTimeout(deleteArmTimeoutRef.current);
      }
      deleteArmTimeoutRef.current = window.setTimeout(() => {
        setIsDeleteArmed(false);
      }, 3000);
      return;
    }

    if (deleteArmTimeoutRef.current) {
      window.clearTimeout(deleteArmTimeoutRef.current);
      deleteArmTimeoutRef.current = null;
    }
    setIsDeleteArmed(false);

    setIsDeleting(true);
    try {
      const rowId = Number((shipped as any).tech_serial_id);
      if (!Number.isFinite(rowId) || rowId <= 0) {
        throw new Error('Missing tech row id for delete');
      }

      const response = await fetch('/api/tech/delete-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rowId,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to delete tech records');
      }

      onUpdate?.();
      dispatchDashboardAndStationRefresh();
      dispatchCloseShippedDetails();
    } catch (error) {
      console.error('Failed to delete tech records:', error);
      window.alert('Failed to delete tech records. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="pb-8 pt-4 space-y-4">
      <ShippedDetailsPanelContent
        shipped={shipped}
        durationData={durationData}
        copiedAll={copiedAll}
        onCopyAll={onCopyAll}
        productDetailsFirst={false}
        showPackingPhotos={false}
        showPackingInformation={false}
        showTestingInformation={false}
        showSerialNumber
      />

      <section className="mx-8 pt-2">
        <button
          type="button"
          onClick={deleteTechOrder}
          disabled={isDeleting}
          className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {isDeleting
            ? 'Deleting...'
            : isDeleteArmed
              ? 'Click Again To Confirm'
              : 'Delete Tech Order'}
        </button>
      </section>
    </div>
  );
}
