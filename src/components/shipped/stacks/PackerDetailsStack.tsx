'use client';

import { useEffect, useRef, useState } from 'react';
import { PackageCheck, Trash2 } from '@/components/Icons';
import { ShippedDetailsPanelContent } from '../ShippedDetailsPanelContent';
import { DetailsStackProps } from './types';
import { dispatchCloseShippedDetails, dispatchDashboardAndStationRefresh } from '@/utils/events';
import { formatDatePST, formatDateTimePST, toPSTDateKey } from '@/utils/date';
import { getStaffName } from '@/utils/staff';
import { getActiveStaff } from '@/lib/staffCache';
import { PanelActionBar } from '@/components/shipped/details-panel/PanelActionBar';

type PackerOption = { id: number; name: string };

function toLocalDateTimeInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

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
  const [isMarkAsShippedOpen, setIsMarkAsShippedOpen] = useState(false);
  const [isMarkingShipped, setIsMarkingShipped] = useState(false);
  const [markShippedError, setMarkShippedError] = useState<string | null>(null);
  const [packerOptions, setPackerOptions] = useState<PackerOption[]>([]);
  const [selectedPackerId, setSelectedPackerId] = useState<number | null>(
    (shipped as any).packed_by ?? (shipped as any).packer_id ?? null
  );
  const [packedAt, setPackedAt] = useState<string>(toLocalDateTimeInputValue(new Date()));
  const deleteArmTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (deleteArmTimeoutRef.current) {
        window.clearTimeout(deleteArmTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setIsMarkAsShippedOpen(false);
    setIsMarkingShipped(false);
    setMarkShippedError(null);
    setPackedAt(toLocalDateTimeInputValue(new Date()));
    setSelectedPackerId((shipped as any).packed_by ?? (shipped as any).packer_id ?? null);
  }, [shipped.id, (shipped as any).packed_by, (shipped as any).packer_id]);

  useEffect(() => {
    let active = true;
    getActiveStaff()
      .then((staff) => {
        if (!active) return;
        const packers = staff
          .filter((member) => String(member.role || '').toLowerCase() === 'packer')
          .map((member) => ({ id: member.id, name: member.name }));
        setPackerOptions(packers);
      })
      .catch((error) => {
        console.error('Failed to load packer options:', error);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (selectedPackerId || packerOptions.length === 0) return;
    if ((shipped as any).packed_by) {
      setSelectedPackerId(Number((shipped as any).packed_by));
      return;
    }
    if ((shipped as any).packer_id) {
      setSelectedPackerId(Number((shipped as any).packer_id));
      return;
    }
    setSelectedPackerId(packerOptions[0].id);
  }, [packerOptions, selectedPackerId, shipped]);

  const markAsShipped = async () => {
    setMarkShippedError(null);

    const trackingNumber = String(shipped.shipping_tracking_number || '').trim();
    if (!trackingNumber) {
      setMarkShippedError('Tracking number is required.');
      return;
    }

    if (!selectedPackerId) {
      setMarkShippedError('Select a packer.');
      return;
    }

    const packedDate = new Date(packedAt);
    if (!packedAt || Number.isNaN(packedDate.getTime())) {
      setMarkShippedError('Provide a valid packed time.');
      return;
    }

    setIsMarkingShipped(true);
    try {
      const response = await fetch('/api/packing-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackingNumber,
          photos: [],
          packerId: selectedPackerId,
          timestamp: packedDate.toISOString(),
          packerName: getStaffName(selectedPackerId),
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to mark order as shipped.');
      }

      setIsMarkAsShippedOpen(false);
      onUpdate?.();
      dispatchDashboardAndStationRefresh();
    } catch (error) {
      console.error('Failed to mark order as shipped:', error);
      setMarkShippedError(error instanceof Error ? error.message : 'Failed to mark order as shipped.');
    } finally {
      setIsMarkingShipped(false);
    }
  };

  const shipByDateKey = toPSTDateKey(shipped.ship_by_date || shipped.created_at);
  const shipByDateDisplay = shipByDateKey ? formatDatePST(shipByDateKey, { withLeadingZeros: true }) : 'N/A';

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

      <section className="mx-8 space-y-2">
        <button
          type="button"
          onClick={() => setIsMarkAsShippedOpen((prev) => !prev)}
          disabled={isMarkingShipped}
          className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
        >
          <PackageCheck className="w-3.5 h-3.5" />
          {isMarkingShipped ? 'Marking...' : 'Mark As Shipped'}
        </button>

        {isMarkAsShippedOpen && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[9px] font-black uppercase tracking-[0.14em] text-emerald-800/80 block mb-1">
                  Packed By
                </span>
                <select
                  value={selectedPackerId ?? ''}
                  onChange={(e) => setSelectedPackerId(Number(e.target.value) || null)}
                  className="w-full h-8 rounded-lg border border-emerald-200 bg-white px-2 text-[10px] font-bold text-gray-900 outline-none"
                >
                  <option value="">Select</option>
                  {packerOptions.map((packer) => (
                    <option key={packer.id} value={packer.id}>
                      {packer.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span className="text-[9px] font-black uppercase tracking-[0.14em] text-emerald-800/80 block mb-1">
                  Packed Time
                </span>
                <input
                  type="datetime-local"
                  value={packedAt}
                  onChange={(e) => setPackedAt(e.target.value)}
                  className="w-full h-8 rounded-lg border border-emerald-200 bg-white px-2 text-[10px] font-bold text-gray-900 outline-none"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={markAsShipped}
              disabled={isMarkingShipped}
              className="w-full h-8 inline-flex items-center justify-center rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-black uppercase tracking-wider disabled:opacity-50"
            >
              {isMarkingShipped ? 'Saving...' : 'Confirm Mark As Shipped'}
            </button>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-emerald-200 bg-white px-2 py-1.5">
                <span className="text-[8px] font-black uppercase tracking-wider text-gray-500 block">Packer</span>
                <p className="text-[10px] font-bold text-gray-900 truncate">
                  {selectedPackerId ? getStaffName(selectedPackerId) : 'N/A'}
                </p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-white px-2 py-1.5">
                <span className="text-[8px] font-black uppercase tracking-wider text-gray-500 block">Time</span>
                <p className="text-[10px] font-bold text-gray-900 truncate">
                  {packedAt ? formatDateTimePST(new Date(packedAt)) : 'N/A'}
                </p>
              </div>
            </div>

            {markShippedError && (
              <p className="text-[9px] font-bold text-red-600">{markShippedError}</p>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-2">
          <span className="text-[9px] font-black uppercase tracking-wider text-gray-500 whitespace-nowrap">Ship By Date</span>
          <div className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-[10px] font-bold text-gray-900">
            {shipByDateDisplay}
          </div>
        </div>
      </section>

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
