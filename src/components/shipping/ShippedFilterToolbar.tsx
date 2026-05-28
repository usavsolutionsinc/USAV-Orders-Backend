'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Truck } from '@/components/Icons';
import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { microBadge } from '@/design-system/tokens/typography/presets';
import type { CarrierCode, ShipmentStatusCategory } from '@/components/shipping/ShipmentStatusBadge';

const CARRIERS: ReadonlyArray<{ value: CarrierCode; label: string }> = [
  { value: 'UPS', label: 'UPS' },
  { value: 'USPS', label: 'USPS' },
  { value: 'FEDEX', label: 'FedEx' },
];

const STATUS_CATEGORIES: ReadonlyArray<{ value: ShipmentStatusCategory; label: string }> = [
  { value: 'LABEL_CREATED', label: 'Label created' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'IN_TRANSIT', label: 'In transit' },
  { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'EXCEPTION', label: 'Exception' },
  { value: 'RETURNED', label: 'Returned' },
];

const VALID_CARRIERS = new Set(CARRIERS.map((c) => c.value));
const VALID_STATUS = new Set(STATUS_CATEGORIES.map((s) => s.value));

const CARRIER_SLIDER_ITEMS = [
  { id: 'all', label: 'All', icon: Truck },
  ...CARRIERS.map((c) => ({ id: c.value, label: c.label, icon: Truck })),
];

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

export function ShippedCarrierFilters({
  className,
  basePath,
  layout = 'sidebar',
}: {
  className?: string;
  /** Path the URL is replaced against. Defaults to current `pathname`. */
  basePath?: string;
  layout?: 'sidebar' | 'inline';
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

  const clearAll = useCallback(() => {
    replaceWith((p) => {
      p.delete('exceptions');
      p.delete('carrier');
      p.delete('statusCategory');
    });
  }, [replaceWith]);

  const anyFilter = exceptionsOnly || carrier || statusCategory;

  if (layout === 'inline') {
    return (
      <div className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>
        <NeedsAttentionButton active={exceptionsOnly} onClick={toggleExceptions} compact />
        <CarrierSelect value={carrier} onChange={setCarrier} />
        <StatusSelect value={statusCategory} onChange={setStatus} />
        {anyFilter ? (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs font-bold text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
          >
            Clear
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className ?? ''}`}>
      <div>
        <p className={`${microBadge} px-0.5 text-gray-500`}>Shipment filters</p>
        <div className="mt-2 space-y-2">
          <NeedsAttentionButton active={exceptionsOnly} onClick={toggleExceptions} />
          <HorizontalButtonSlider
            items={CARRIER_SLIDER_ITEMS}
            value={carrier ?? 'all'}
            onChange={(id) => setCarrier(id === 'all' ? null : (id as CarrierCode))}
            variant="nav"
            size="md"
            aria-label="Filter by carrier"
          />
        </div>
      </div>

      <div>
        <p className={`${microBadge} px-0.5 text-gray-500`}>Carrier status</p>
        <div className="mt-1.5 space-y-1">
          {STATUS_CATEGORIES.map((s) => {
            const active = statusCategory === s.value;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => setStatus(active ? null : s.value)}
                aria-pressed={active}
                className={`flex w-full items-center rounded-lg px-2.5 py-2 text-left text-label font-bold ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                  active
                    ? 'bg-blue-600 text-white ring-blue-600'
                    : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {anyFilter ? (
        <button
          type="button"
          onClick={clearAll}
          className="w-full text-center text-xs font-bold text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

/** @deprecated Use {@link ShippedCarrierFilters} in the sidebar instead. */
export function ShippedFilterToolbar(props: { className?: string; basePath?: string }) {
  return <ShippedCarrierFilters {...props} layout="inline" />;
}

function NeedsAttentionButton({
  active,
  onClick,
  compact = false,
}: {
  active: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title="Show only shipments with a carrier exception or no scan in >72h"
      className={
        compact
          ? `inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 ${
              active
                ? 'bg-rose-600 text-white ring-rose-600 hover:bg-rose-700'
                : 'bg-white text-rose-700 ring-rose-200 hover:bg-rose-50'
            }`
          : `flex w-full items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-label font-bold ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 focus:ring-rose-500/40 ${
              active
                ? 'bg-rose-600 text-white ring-rose-600 hover:bg-rose-700'
                : 'bg-white text-rose-700 ring-rose-200 hover:bg-rose-50'
            }`
      }
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      Needs attention
    </button>
  );
}

function CarrierSelect({
  value,
  onChange,
}: {
  value: CarrierCode | null;
  onChange: (next: CarrierCode | null) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-gray-700 ring-1 ring-inset ring-gray-200">
      <Truck className="h-3.5 w-3.5 text-gray-400" />
      <span className="sr-only">Carrier</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange((e.target.value || null) as CarrierCode | null)}
        className="bg-transparent text-xs font-bold text-gray-900 focus:outline-none"
        aria-label="Filter by carrier"
      >
        <option value="">All carriers</option>
        {CARRIERS.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatusSelect({
  value,
  onChange,
}: {
  value: ShipmentStatusCategory | null;
  onChange: (next: ShipmentStatusCategory | null) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-gray-700 ring-1 ring-inset ring-gray-200">
      <span className="sr-only">Status</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange((e.target.value || null) as ShipmentStatusCategory | null)}
        className="bg-transparent text-xs font-bold text-gray-900 focus:outline-none"
        aria-label="Filter by shipment status"
      >
        <option value="">All statuses</option>
        {STATUS_CATEGORIES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}
