'use client';

import { useEffect, useRef, useState } from 'react';
import { Trash2 } from '@/components/Icons';
import { ShippedDetailsPanelContent } from '../ShippedDetailsPanelContent';
import { DetailsStackProps } from './types';
import { dispatchCloseShippedDetails, dispatchDashboardAndStationRefresh } from '@/utils/events';
import { PanelActionBar } from '@/components/shipped/details-panel/PanelActionBar';

export function PackerDetailsStack({
  shipped,
  durationData,
  copiedAll,
  onCopyAll,
  onUpdate,
  actionBar,
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

  const deletePackerLog = async () => {
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
      const packerLogId = Number((shipped as any).packer_log_id);
      const activityLogId = Number((shipped as any).station_activity_log_id);
      const deleteUrl =
        Number.isFinite(packerLogId) && packerLogId > 0
          ? `/api/packerlogs?id=${encodeURIComponent(String(packerLogId))}`
          : Number.isFinite(activityLogId) && activityLogId > 0
            ? `/api/packerlogs?activityLogId=${encodeURIComponent(String(activityLogId))}`
            : null;
      if (!deleteUrl) {
        throw new Error('Missing packer or activity log id for delete');
      }

      const response = await fetch(deleteUrl, {
        method: 'DELETE',
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to delete packer log');
      }

      onUpdate?.();
      dispatchDashboardAndStationRefresh();
      dispatchCloseShippedDetails();
    } catch (error) {
      console.error('Failed to delete packer log:', error);
      window.alert('Failed to delete packer log. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="pb-8 pt-4 space-y-4">
      {actionBar ? <PanelActionBar {...actionBar} /> : null}

      <ShippedDetailsPanelContent
        shipped={shipped}
        durationData={durationData}
        copiedAll={copiedAll}
        onCopyAll={onCopyAll}
        onUpdate={onUpdate}
        showTestingInformation={false}
      />

      <section className="mx-8 pt-2">
        <button
          type="button"
          onClick={deletePackerLog}
          disabled={isDeleting}
          className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {isDeleting
            ? 'Deleting...'
            : isDeleteArmed
              ? 'Click Again To Confirm'
              : 'Delete Packer Log'}
        </button>
      </section>
    </div>
  );
}
