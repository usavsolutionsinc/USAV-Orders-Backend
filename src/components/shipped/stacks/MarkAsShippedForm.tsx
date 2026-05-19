'use client';

import { useState } from 'react';
import { formatDateTimePST } from '@/utils/date';
import { getStaffName } from '@/utils/staff';
import { StaffButtonGrid } from '@/components/shipping/StaffButtonGrid';

function toLocalDateTimeInputValue(date: Date): string {
  const year  = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day   = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const mins  = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${mins}`;
}

interface MarkAsShippedFormProps {
  shippingTrackingNumber: string;
  packerOptions: { id: number; name: string }[];
  onSuccess: () => void;
  onError?: (msg: string) => void;
}

export function MarkAsShippedForm({
  shippingTrackingNumber,
  packerOptions,
  onSuccess,
}: MarkAsShippedFormProps) {
  const [selectedPackerId, setSelectedPackerId] = useState<number | null>(null);
  const [packedAt, setPackedAt] = useState(toLocalDateTimeInputValue(new Date()));
  const [isMarkingShipped, setIsMarkingShipped] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setError(null);
    const trackingNumber = String(shippingTrackingNumber || '').trim();
    if (!trackingNumber) { setError('Tracking number is required before marking as shipped.'); return; }
    if (!selectedPackerId) { setError('Select a packer.'); return; }
    const packedDate = new Date(packedAt);
    if (!packedAt || Number.isNaN(packedDate.getTime())) { setError('Provide a valid date and time.'); return; }

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
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Failed to mark order as shipped.');
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark order as shipped.');
    } finally {
      setIsMarkingShipped(false);
    }
  };

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 space-y-2.5">
      <StaffButtonGrid
        label="Packer"
        options={packerOptions}
        selectedId={selectedPackerId}
        onSelect={(id) => setSelectedPackerId(id)}
        columns={Math.min(packerOptions.length, 4)}
        emptyMessage="No packers available"
      />

      <div>
        <span className="text-[9px] font-black uppercase tracking-[0.14em] text-emerald-800/80 block mb-1">
          Date &amp; Time
        </span>
        <input
          type="datetime-local"
          value={packedAt}
          onChange={(e) => setPackedAt(e.target.value)}
          className="w-full h-8 rounded-lg border border-emerald-200 bg-white px-2 text-[10px] font-bold text-gray-900 outline-none"
        />
        <p className="mt-1 text-[9px] font-bold text-gray-600">
          {packedAt ? formatDateTimePST(new Date(packedAt)) : 'N/A'} ·{' '}
          {selectedPackerId ? getStaffName(selectedPackerId) : 'No packer'}
        </p>
      </div>

      <button
        type="button"
        onClick={handleConfirm}
        disabled={isMarkingShipped}
        className="w-full h-8 inline-flex items-center justify-center rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-black uppercase tracking-wider disabled:opacity-50"
      >
        {isMarkingShipped ? 'Saving...' : 'Confirm Mark As Shipped'}
      </button>

      {error && <p className="text-[9px] font-bold text-red-600">{error}</p>}
    </div>
  );
}
