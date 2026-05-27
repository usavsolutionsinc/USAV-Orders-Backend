'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Truck } from '@/components/Icons';
import type { CarrierCode, ShipmentStatusCategory } from '@/components/shipping/ShipmentStatusBadge';

const CARRIERS: ReadonlyArray<{ value: CarrierCode; label: string }> = [
  { value: 'UPS', label: 'UPS' },
  { value: 'USPS', label: 'USPS' },
  { value: 'FEDEX', label: 'FedEx' },
];

const STATUS_CATEGORIES: ReadonlyArray<{ value: ShipmentStatusCategory; label: string }> = [
  { value: 'LABEL_CREATED',    label: 'Label created' },
  { value: 'ACCEPTED',         label: 'Accepted' },
  { value: 'IN_TRANSIT',       label: 'In transit' },
  { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { value: 'DELIVERED',        label: 'Delivered' },
  { value: 'EXCEPTION',        label: 'Exception' },
  { value: 'RETURNED',         label: 'Returned' },
];

const VALID_CARRIERS = new Set(CARRIERS.map((c) => c.value));
const VALID_STATUS = new Set(STATUS_CATEGORIES.map((s) => s.value));

export function readShippedCarrierFilter(searchParams: URLSearchParams | { get: (k: string) => string | null }): CarrierCode | null {
  const raw = String(searchParams.get('carrier') || '').toUpperCase();
  return VALID_CARRIERS.has(raw as CarrierCode) ? (raw as CarrierCode) : null;
}

export function readShippedStatusFilter(searchParams: URLSearchParams | { get: (k: string) => string | null }): ShipmentStatusCategory | null {
  const raw = String(searchParams.get('statusCategory') || '').toUpperCase();
  return VALID_STATUS.has(raw as ShipmentStatusCategory) ? (raw as ShipmentStatusCategory) : null;
}

export function readShippedExceptionsFilter(searchParams: URLSearchParams | { get: (k: string) => string | null }): boolean {
  const raw = String(searchParams.get('exceptions') || '').toLowerCase();
  return raw === '1' || raw === 'true';
}

export function ShippedFilterToolbar({
  className,
  basePath,
}: {
  className?: string;
  /** Path the URL is replaced against. Defaults to current `pathname`. */
  basePath?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const exceptionsOnly = readShippedExceptionsFilter(searchParams);
  const carrier = readShippedCarrierFilter(searchParams);
  const statusCategory = readShippedStatusFilter(searchParams);

  const replaceWith = useCallback(
    (mutator: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutator(params);
      const target = basePath || pathname || '/dashboard';
      const search = params.toString();
      router.replace(search ? `${target}?${search}` : target, { scroll: false });
    },
    [basePath, pathname, router, searchParams],
  );

  const toggleExceptions = useCallback(() => {
    replaceWith((p) => {
      if (exceptionsOnly) p.delete('exceptions');
      else p.set('exceptions', '1');
    });
  }, [exceptionsOnly, replaceWith]);

  const setCarrier = useCallback(
    (next: CarrierCode | null) => {
      replaceWith((p) => {
        if (next) p.set('carrier', next);
        else p.delete('carrier');
      });
    },
    [replaceWith],
  );

  const setStatus = useCallback(
    (next: ShipmentStatusCategory | null) => {
      replaceWith((p) => {
        if (next) p.set('statusCategory', next);
        else p.delete('statusCategory');
      });
    },
    [replaceWith],
  );

  const anyFilter = exceptionsOnly || carrier || statusCategory;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>
      <button
        type="button"
        onClick={toggleExceptions}
        aria-pressed={exceptionsOnly}
        title="Show only shipments with a carrier exception or no scan in >72h"
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 ${
          exceptionsOnly
            ? 'bg-rose-600 text-white ring-rose-600 hover:bg-rose-700'
            : 'bg-white text-rose-700 ring-rose-200 hover:bg-rose-50'
        }`}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Needs attention
      </button>

      <label className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-gray-700 ring-1 ring-inset ring-gray-200">
        <Truck className="h-3.5 w-3.5 text-gray-400" />
        <span className="sr-only">Carrier</span>
        <select
          value={carrier ?? ''}
          onChange={(e) => setCarrier((e.target.value || null) as CarrierCode | null)}
          className="bg-transparent text-xs font-bold text-gray-900 focus:outline-none"
          aria-label="Filter by carrier"
        >
          <option value="">All carriers</option>
          {CARRIERS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </label>

      <label className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-gray-700 ring-1 ring-inset ring-gray-200">
        <span className="sr-only">Status</span>
        <select
          value={statusCategory ?? ''}
          onChange={(e) => setStatus((e.target.value || null) as ShipmentStatusCategory | null)}
          className="bg-transparent text-xs font-bold text-gray-900 focus:outline-none"
          aria-label="Filter by shipment status"
        >
          <option value="">All statuses</option>
          {STATUS_CATEGORIES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </label>

      {anyFilter ? (
        <button
          type="button"
          onClick={() =>
            replaceWith((p) => {
              p.delete('exceptions');
              p.delete('carrier');
              p.delete('statusCategory');
            })
          }
          className="text-xs font-bold text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
