'use client';

import { useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, Layers, Package, RotateCcw, Truck } from '@/components/Icons';
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

type ShippedTypeFilter = 'all' | 'orders' | 'sku' | 'fba';

const TONE = {
  rose: {
    active: 'bg-rose-600 text-white ring-rose-600',
    inactive: 'bg-white text-rose-700 ring-rose-200 hover:bg-rose-50',
    ring: 'focus:ring-rose-500/40',
    iconActive: 'text-white',
    iconInactive: 'text-rose-500',
  },
  amber: {
    active: 'bg-amber-600 text-white ring-amber-600',
    inactive: 'bg-white text-amber-800 ring-amber-200 hover:bg-amber-50',
    ring: 'focus:ring-amber-500/40',
    iconActive: 'text-white',
    iconInactive: 'text-amber-500',
  },
  blue: {
    active: 'bg-blue-600 text-white ring-blue-600',
    inactive: 'bg-white text-blue-700 ring-blue-200 hover:bg-blue-50',
    ring: 'focus:ring-blue-500/40',
    iconActive: 'text-white',
    iconInactive: 'text-blue-500',
  },
  orange: {
    active: 'bg-orange-600 text-white ring-orange-600',
    inactive: 'bg-white text-orange-800 ring-orange-200 hover:bg-orange-50',
    ring: 'focus:ring-orange-500/40',
    iconActive: 'text-white',
    iconInactive: 'text-orange-500',
  },
  gray: {
    active: 'bg-gray-700 text-white ring-gray-700',
    inactive: 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50',
    ring: 'focus:ring-gray-500/40',
    iconActive: 'text-white',
    iconInactive: 'text-gray-500',
  },
  slate: {
    active: 'bg-slate-900 text-white ring-slate-900',
    inactive: 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50',
    ring: 'focus:ring-slate-500/40',
    iconActive: 'text-white',
    iconInactive: 'text-slate-500',
  },
} as const;

type ToneKey = keyof typeof TONE;

const TYPE_TILES: ReadonlyArray<{
  value: ShippedTypeFilter;
  label: string;
  tone: ToneKey;
  icon: React.FC<{ className?: string }>;
  countKey: 'total' | 'orders_count' | 'sku_count' | 'fba_count';
}> = [
  { value: 'all',    label: 'All',    tone: 'slate',  icon: Layers,  countKey: 'total' },
  { value: 'orders', label: 'Orders', tone: 'blue',   icon: Package, countKey: 'orders_count' },
  { value: 'sku',    label: 'SKU',    tone: 'gray',   icon: Package, countKey: 'sku_count' },
  { value: 'fba',    label: 'FBA',    tone: 'orange', icon: Package, countKey: 'fba_count' },
];

const STATUS_TILES: ReadonlyArray<{
  value: ShipmentStatusCategory;
  label: string;
  tone: ToneKey;
  icon: React.FC<{ className?: string }>;
  countKey: keyof ShippedSummary;
}> = [
  { value: 'EXCEPTION',        label: 'Exception',        tone: 'rose',  icon: AlertTriangle, countKey: 'exception' },
  { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery', tone: 'amber', icon: Truck,         countKey: 'out_for_delivery' },
  { value: 'IN_TRANSIT',       label: 'In transit',       tone: 'blue',  icon: Truck,         countKey: 'in_transit' },
  { value: 'LABEL_CREATED',    label: 'Label created',    tone: 'gray',  icon: Package,       countKey: 'label_created' },
  { value: 'ACCEPTED',         label: 'Accepted',         tone: 'gray',  icon: Package,       countKey: 'accepted' },
  { value: 'DELIVERED',        label: 'Delivered',        tone: 'slate', icon: Package,       countKey: 'delivered' },
  { value: 'RETURNED',         label: 'Returned',         tone: 'orange',icon: RotateCcw,     countKey: 'returned' },
];

interface ShippedSummary {
  total: number;
  orders_count: number;
  fba_count: number;
  sku_count: number;
  needs_attention: number;
  exception: number;
  out_for_delivery: number;
  in_transit: number;
  label_created: number;
  accepted: number;
  delivered: number;
  returned: number;
}

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

function readShippedTypeFilter(searchParams: URLSearchParams | { get: (k: string) => string | null }): ShippedTypeFilter {
  const raw = String(searchParams.get('shippedFilter') || '').toLowerCase();
  if (raw === 'orders' || raw === 'sku' || raw === 'fba') return raw;
  return 'all';
}

export function ShippedCarrierFilters({
  className,
  basePath,
  layout = 'sidebar',
}: {
  className?: string;
  basePath?: string;
  layout?: 'sidebar' | 'inline';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [statusOpen, setStatusOpen] = useState(false);

  const exceptionsOnly = readShippedExceptionsFilter(searchParams);
  const carrier = readShippedCarrierFilter(searchParams);
  const statusCategory = readShippedStatusFilter(searchParams);
  const typeFilter = readShippedTypeFilter(searchParams);

  const { data: summary } = useQuery<ShippedSummary>({
    queryKey: ['shipped-summary'],
    queryFn: async () => {
      const res = await fetch('/api/shipped/summary', { cache: 'no-store' });
      if (!res.ok) throw new Error('summary fetch failed');
      const data = await res.json();
      return data as ShippedSummary;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

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

  const setTypeFilter = useCallback(
    (next: ShippedTypeFilter) => {
      replaceWith((p) => {
        if (next === 'all') p.delete('shippedFilter');
        else p.set('shippedFilter', next);
      });
    },
    [replaceWith],
  );

  const clearAll = useCallback(() => {
    replaceWith((p) => {
      p.delete('exceptions');
      p.delete('carrier');
      p.delete('statusCategory');
      p.delete('shippedFilter');
    });
  }, [replaceWith]);

  const anyFilter = exceptionsOnly || carrier || statusCategory || typeFilter !== 'all';

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
    <div className={`space-y-1.5 ${className ?? ''}`}>
      {/* Type filter tiles — replaces the removed ALL/ORDERS/SKU/FBA pill row */}
      <div className="space-y-1">
        {TYPE_TILES.map((tile) => {
          const active = typeFilter === tile.value;
          const tone = TONE[tile.tone];
          const Icon = tile.icon;
          const count = summary ? summary[tile.countKey] : null;
          return (
            <button
              key={tile.value}
              type="button"
              onClick={() => setTypeFilter(active && tile.value !== 'all' ? 'all' : tile.value)}
              aria-pressed={active}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-label font-bold ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 ${
                active ? tone.active : tone.inactive
              } ${tone.ring}`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${active ? tone.iconActive : tone.iconInactive}`} />
              <span className="flex-1 truncate">{tile.label}</span>
              <span className="ml-1 tabular-nums text-caption font-black">
                {count == null ? '—' : count.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>

      {/* Needs attention tile */}
      <button
        type="button"
        onClick={toggleExceptions}
        aria-pressed={exceptionsOnly}
        title="Show only shipments with a carrier exception or no scan in >72h"
        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-label font-bold ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 ${
          exceptionsOnly ? TONE.rose.active : TONE.rose.inactive
        } ${TONE.rose.ring}`}
      >
        <AlertTriangle className={`h-4 w-4 shrink-0 ${exceptionsOnly ? TONE.rose.iconActive : TONE.rose.iconInactive}`} />
        <span className="flex-1 truncate">Needs attention</span>
        <span className="ml-1 tabular-nums text-caption font-black">
          {summary == null ? '—' : summary.needs_attention.toLocaleString()}
        </span>
      </button>

      {/* Carrier select */}
      <label className="flex items-center justify-between gap-2 text-eyebrow font-black uppercase tracking-wider text-gray-500">
        <span className="shrink-0">Carrier</span>
        <div className="relative flex-1">
          <select
            value={carrier ?? ''}
            onChange={(e) => setCarrier((e.target.value || null) as CarrierCode | null)}
            className="h-8 w-full cursor-pointer appearance-none rounded-md border border-gray-200 bg-white pl-2 pr-7 text-caption font-semibold text-gray-900 hover:border-blue-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            aria-label="Filter by carrier"
          >
            <option value="">All carriers</option>
            {CARRIERS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        </div>
      </label>

      {/* Status — collapsible section */}
      <div>
        <button
          type="button"
          onClick={() => setStatusOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-1 py-1 text-eyebrow font-black uppercase tracking-wider text-gray-500 hover:text-gray-800"
          aria-expanded={statusOpen}
        >
          <span>Carrier status</span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-150 ${statusOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {statusOpen ? (
          <div className="mt-1 space-y-1">
            {STATUS_TILES.map((tile) => {
              const active = statusCategory === tile.value;
              const tone = TONE[tile.tone];
              const Icon = tile.icon;
              const count = summary ? (summary[tile.countKey] as number) : null;
              return (
                <button
                  key={tile.value}
                  type="button"
                  onClick={() => setStatus(active ? null : tile.value)}
                  aria-pressed={active}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-label font-bold ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 ${
                    active ? tone.active : tone.inactive
                  } ${tone.ring}`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${active ? tone.iconActive : tone.iconInactive}`} />
                  <span className="flex-1 truncate">{tile.label}</span>
                  <span className="ml-1 tabular-nums text-caption font-black">
                    {count == null ? '—' : count.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
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
