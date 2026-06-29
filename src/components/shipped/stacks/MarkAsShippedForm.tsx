'use client';

import { useState } from 'react';
import { getStaffName } from '@/utils/staff';
import { Button } from '@/design-system/primitives';
import { FILTER_DROPDOWN_LABEL_CLASS } from '@/design-system/components/FilterDropdownSelect';
import { DateTimePickerField } from '@/design-system/components/DateTimePickerField';
import { SearchableSelectField } from '@/design-system/components/SearchableSelectField';
import { type StaffRecipient } from '@/components/quick-access/StaffRecipientList';

interface MarkAsShippedFormProps {
  shippingTrackingNumber: string;
  packerOptions: StaffRecipient[];
  onSuccess: () => void;
  onError?: (msg: string) => void;
}

export function MarkAsShippedForm({
  shippingTrackingNumber,
  packerOptions,
  onSuccess,
}: MarkAsShippedFormProps) {
  const [selectedPackerId, setSelectedPackerId] = useState<number | null>(null);
  const [packedAt, setPackedAt] = useState<Date | undefined>(() => new Date());
  const [isMarkingShipped, setIsMarkingShipped] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setError(null);
    const trackingNumber = String(shippingTrackingNumber || '').trim();
    if (!trackingNumber) { setError('Tracking number is required before marking as shipped.'); return; }
    if (!selectedPackerId) { setError('Select a packer.'); return; }
    const packedDate = packedAt;
    if (!packedDate || Number.isNaN(packedDate.getTime())) { setError('Provide a valid date and time.'); return; }

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
      <div>
        <span className={FILTER_DROPDOWN_LABEL_CLASS}>Packer</span>
        <SearchableSelectField
          value={selectedPackerId}
          onChange={(v) => setSelectedPackerId(v == null ? null : Number(v))}
          options={packerOptions.map((p) => ({ value: p.id, label: p.name, meta: p.role }))}
          placeholder={packerOptions.length ? 'Select a packer…' : 'No staff available'}
          searchPlaceholder="Search staff…"
          emptyMessage="No staff match"
          tone="emerald"
          ariaLabel="Select packer"
        />
      </div>

      <div>
        <span className={FILTER_DROPDOWN_LABEL_CLASS}>Date &amp; Time</span>
        <DateTimePickerField
          value={packedAt}
          onChange={setPackedAt}
          tone="emerald"
          placeholder="Pick a date & time"
        />
      </div>

      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={handleConfirm}
        disabled={isMarkingShipped}
        className="w-full bg-emerald-600 hover:bg-emerald-700"
      >
        {isMarkingShipped ? 'Saving...' : 'Confirm Mark As Shipped'}
      </Button>

      {error && <p className="text-eyebrow font-bold text-red-600">{error}</p>}
    </div>
  );
}
