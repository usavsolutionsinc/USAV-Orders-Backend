'use client';

import { useEffect, useRef, useState } from 'react';
import { Trash2 } from '@/components/Icons';
import { ShippedDetailsPanelContent } from '../ShippedDetailsPanelContent';
import { DetailsStackProps } from './types';
import { dispatchCloseShippedDetails, dispatchDashboardAndStationRefresh } from '@/utils/events';
import { Button } from '@/design-system/primitives';

export function PackerDetailsStack({
  shipped,
  durationData,
  copiedAll,
  onCopyAll,
  onUpdate,
  actionBar: _actionBar,
  activeSection,
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
    <div className="flex min-h-full flex-col pb-8 pt-4">
      <div className="flex-1">
      <ShippedDetailsPanelContent
        shipped={shipped}
        durationData={durationData}
        copiedAll={copiedAll}
        onCopyAll={onCopyAll}
        onUpdate={onUpdate}
        activeSection={activeSection}
      />
      </div>

      <section className="mx-8 pt-2">
        <Button
          type="button"
          variant="danger"
          size="lg"
          onClick={deletePackerLog}
          disabled={isDeleting}
          icon={<Trash2 className="w-3.5 h-3.5" />}
          className="w-full"
        >
          {isDeleting
            ? 'Deleting...'
            : isDeleteArmed
              ? 'Click Again To Confirm'
              : 'Delete'}
        </Button>
      </section>
    </div>
  );
}
