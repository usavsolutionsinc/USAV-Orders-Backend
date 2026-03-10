'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { SearchBar } from '@/components/ui/SearchBar';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import StaffSelector from '@/components/StaffSelector';
import PendingUnboxingQueue from '@/components/station/PendingUnboxingQueue';
import { invalidateReceivingCache } from '@/lib/receivingCache';
import { RECEIVING_CARRIERS } from '@/components/station/receiving-constants';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import type { ReceivingDetailsLog } from '@/components/station/ReceivingDetailsStack';

export { RECEIVING_CARRIERS };

const RECEIVING_MODE_OPTIONS = [
  { value: 'bulk', label: 'Bulk Scan' },
  { value: 'unboxing', label: 'Unboxing' },
  { value: 'pickup', label: 'Local Pickup' },
];

type ReceivingMode = 'bulk' | 'unboxing' | 'pickup';

export function ReceivingSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const rawMode = searchParams.get('mode');
  const mode: ReceivingMode = rawMode === 'unboxing' ? 'unboxing' : rawMode === 'pickup' ? 'pickup' : 'bulk';
  const staffId = searchParams.get('staffId') || '7';

  // When a line is selected in unboxing mode, open the parent receiving log via ReceivingDetailsStack
  useEffect(() => {
    const onSelect = (e: Event) => {
      const line = (e as CustomEvent<ReceivingLineRow | null>).detail;
      if (!line?.receiving_id) return;
      const logDetail: ReceivingDetailsLog = {
        id: String(line.receiving_id),
        timestamp: line.created_at || '',
        tracking: line.tracking_number || '',
        status: line.carrier || '',
        qa_status: line.qa_status || 'PENDING',
        disposition_code: line.disposition_code || 'ACCEPT',
        condition_grade: line.condition_grade || 'BRAND_NEW',
        needs_test: true,
      };
      window.dispatchEvent(new CustomEvent('receiving-select-log', { detail: logDetail }));
    };
    window.addEventListener('receiving-select-line', onSelect);
    return () => window.removeEventListener('receiving-select-line', onSelect);
  }, []);

  // Clear line selection highlight when leaving unboxing mode
  useEffect(() => {
    if (mode !== 'unboxing') {
      window.dispatchEvent(new CustomEvent('receiving-clear-line'));
    }
  }, [mode]);

  const [carrier, setCarrier] = useState('');
  const carrierScrollRef = useRef<HTMLDivElement>(null);
  const handleCarrierWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (carrierScrollRef.current) {
      carrierScrollRef.current.scrollLeft += e.deltaY + e.deltaX;
    }
  }, []);

  const [bulkTracking, setBulkTracking] = useState('');
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const submitBulkScan = useCallback(async () => {
    const trackingNumber = bulkTracking.trim();
    if (!trackingNumber || bulkSubmitting) return;
    setBulkSubmitting(true);
    try {
      const res = await fetch('/api/receiving-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackingNumber,
          carrier: carrier || undefined,
          qaStatus: 'PENDING',
          dispositionCode: 'HOLD',
          conditionGrade: 'BRAND_NEW',
          isReturn: false,
          needsTest: true,
        }),
      });
      if (!res.ok) throw new Error('Failed to add receiving entry');
      const data = await res.json();
      setBulkTracking('');
      invalidateReceivingCache();
      queryClient.invalidateQueries({ queryKey: ['receiving-logs'] });
      if (data?.record) {
        window.dispatchEvent(new CustomEvent('receiving-entry-added', { detail: data.record }));
      }
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch {
      window.alert('Failed to add receiving entry.');
    } finally {
      setBulkSubmitting(false);
    }
  }, [bulkTracking, carrier, bulkSubmitting, queryClient]);

  const updateMode = (nextMode: ReceivingMode) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('mode', nextMode);
    router.replace(`/receiving?${nextParams.toString()}`);
  };

  const updateStaff = (id: number) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('staffId', String(id));
    router.replace(`/receiving?${nextParams.toString()}`);
  };

  const handleSelectReceivingId = useCallback((receivingId: number) => {
    window.dispatchEvent(
      new CustomEvent('receiving-select-log', {
        detail: { id: String(receivingId), timestamp: '' },
      }),
    );
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Staff + mode selector */}
      <div className="border-b border-gray-200 bg-white">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-gray-200">
          <div className="min-w-0">
            <StaffSelector
              role="all"
              variant="boxy"
              selectedStaffId={parseInt(staffId, 10)}
              onSelect={updateStaff}
            />
          </div>
          <div className="relative min-w-0">
            <ViewDropdown
              options={RECEIVING_MODE_OPTIONS}
              value={mode}
              onChange={(nextMode) => updateMode(nextMode as ReceivingMode)}
              variant="boxy"
              buttonClassName="h-full w-full appearance-none text-[10px] font-black uppercase tracking-wider text-gray-700 bg-white px-3 py-3 pr-8 hover:bg-gray-50 transition-all rounded-none outline-none text-left"
              optionClassName="text-[10px] font-black tracking-wider"
            />
          </div>
        </div>
      </div>

      {/* Search bar */}
      <div className="border-b border-gray-200 bg-white px-3 py-2">
        <SearchBar
          value={bulkTracking}
          onChange={setBulkTracking}
          onSearch={submitBulkScan}
          onClear={() => setBulkTracking('')}
          placeholder="Scan or enter tracking…"
          variant="blue"
          isSearching={bulkSubmitting}
        />
      </div>

      {/* Carrier slider — bulk scan only */}
      {mode === 'bulk' && (
        <div className="border-b border-gray-100 bg-white px-3 py-2">
          <div
            ref={carrierScrollRef}
            onWheel={handleCarrierWheel}
            className="overflow-x-auto w-full"
            style={{ scrollbarWidth: 'none' }}
          >
            <div className="flex gap-1.5 w-max">
              {RECEIVING_CARRIERS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCarrier(c.value)}
                  className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all ${
                    carrier === c.value
                      ? 'bg-gray-900 text-white'
                      : 'border border-gray-200 bg-white text-gray-500 hover:text-gray-800 hover:border-gray-300'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Pending unboxing queue */}
      <div className="flex-1 overflow-hidden">
        <PendingUnboxingQueue onSelectReceivingId={handleSelectReceivingId} />
      </div>
    </div>
  );
}
