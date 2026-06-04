'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { DateRange } from 'react-day-picker';
import { AlertTriangle, ChevronDown, Filter, Truck, X } from '@/components/Icons';
import type { HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { DateRangePickerField } from '@/design-system/components/DateRangePickerField';
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

interface StaffOption {
  id: number;
  name: string;
}

// Type filter is a *view switcher* (Shopify-style segmented tabs), not a refinement.
const TYPE_ITEMS: HorizontalSliderItem[] = [
  { id: 'all', label: 'All' },
  { id: 'orders', label: 'Orders' },
  { id: 'sku', label: 'SKU' },
  { id: 'fba', label: 'FBA' },
];

const CARRIER_LABEL = new Map(CARRIERS.map((c) => [c.value, c.label]));
const STATUS_LABEL = new Map(STATUS_CATEGORIES.map((s) => [s.value, s.label]));
const TYPE_LABEL = new Map(TYPE_ITEMS.map((t) => [String(t.id), t.label]));

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

function parseStaffId(raw: string | null): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseISODate(raw: string | null): Date | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return undefined;
  const d = new Date(`${raw.trim()}T00:00:00`);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

function toISODate(d: Date | undefined): string | null {
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function useShippedFilterRefinements() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const exceptionsOnly = readShippedExceptionsFilter(searchParams);
  const carrier = readShippedCarrierFilter(searchParams);
  const statusCategory = readShippedStatusFilter(searchParams);
  const typeFilter = readShippedTypeFilter(searchParams);
  const testedBy = parseStaffId(searchParams.get('testedBy'));
  const packedBy = parseStaffId(searchParams.get('packedBy'));
  const dateFrom = parseISODate(searchParams.get('dateFrom'));
  const dateTo = parseISODate(searchParams.get('dateTo'));

  const { data: techs = [] } = useQuery<StaffOption[]>({
    queryKey: ['staff', 'technician'],
    queryFn: async () => {
      const res = await fetch('/api/staff?role=technician&active=true');
      if (!res.ok) throw new Error('staff fetch failed');
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });
  const { data: packers = [] } = useQuery<StaffOption[]>({
    queryKey: ['staff', 'packer'],
    queryFn: async () => {
      const res = await fetch('/api/staff?role=packer&active=true');
      if (!res.ok) throw new Error('staff fetch failed');
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  const techName = useMemo(() => new Map(techs.map((t) => [t.id, t.name])), [techs]);
  const packerName = useMemo(() => new Map(packers.map((p) => [p.id, p.name])), [packers]);

  const replaceWith = useCallback(
    (mutator: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutator(params);
      params.delete('shippedPage');
      const target = pathname || '/dashboard';
      const search = params.toString();
      router.replace(search ? `${target}?${search}` : target, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const toggleExceptions = useCallback(() => {
    replaceWith((p) => {
      if (exceptionsOnly) p.delete('exceptions');
      else p.set('exceptions', '1');
    });
  }, [exceptionsOnly, replaceWith]);

  const setCarrier = useCallback((next: CarrierCode | null) => {
    replaceWith((p) => { next ? p.set('carrier', next) : p.delete('carrier'); });
  }, [replaceWith]);

  const setStatus = useCallback((next: ShipmentStatusCategory | null) => {
    replaceWith((p) => { next ? p.set('statusCategory', next) : p.delete('statusCategory'); });
  }, [replaceWith]);

  const setTestedBy = useCallback((next: number | null) => {
    replaceWith((p) => { next ? p.set('testedBy', String(next)) : p.delete('testedBy'); });
  }, [replaceWith]);

  const setPackedBy = useCallback((next: number | null) => {
    replaceWith((p) => { next ? p.set('packedBy', String(next)) : p.delete('packedBy'); });
  }, [replaceWith]);

  const setDateRange = useCallback((next: DateRange | undefined) => {
    replaceWith((p) => {
      const from = toISODate(next?.from);
      const to = toISODate(next?.to ?? next?.from);
      from ? p.set('dateFrom', from) : p.delete('dateFrom');
      to ? p.set('dateTo', to) : p.delete('dateTo');
    });
  }, [replaceWith]);

  const setTypeFilter = useCallback((next: ShippedTypeFilter) => {
    replaceWith((p) => { next === 'all' ? p.delete('shippedFilter') : p.set('shippedFilter', next); });
  }, [replaceWith]);

  const clearAll = useCallback(() => {
    replaceWith((p) => {
      ['exceptions', 'carrier', 'statusCategory', 'testedBy', 'packedBy', 'dateFrom', 'dateTo'].forEach((k) => p.delete(k));
    });
  }, [replaceWith]);

  const refinements = useMemo(() => {
    const out: Array<{ id: string; label: string; onRemove: () => void }> = [];
    if (typeFilter !== 'all') out.push({ id: 'type', label: TYPE_LABEL.get(typeFilter) ?? typeFilter, onRemove: () => setTypeFilter('all') });
    if (exceptionsOnly) out.push({ id: 'ex', label: 'Needs attention', onRemove: toggleExceptions });
    if (carrier) out.push({ id: 'carrier', label: CARRIER_LABEL.get(carrier) ?? carrier, onRemove: () => setCarrier(null) });
    if (statusCategory) out.push({ id: 'status', label: STATUS_LABEL.get(statusCategory) ?? statusCategory, onRemove: () => setStatus(null) });
    if (testedBy) out.push({ id: 'tester', label: `Tech: ${techName.get(testedBy) ?? `#${testedBy}`}`, onRemove: () => setTestedBy(null) });
    if (packedBy) out.push({ id: 'packer', label: `Packer: ${packerName.get(packedBy) ?? `#${packedBy}`}`, onRemove: () => setPackedBy(null) });
    if (dateFrom) {
      const label = dateTo && toISODate(dateTo) !== toISODate(dateFrom)
        ? `${toISODate(dateFrom)} → ${toISODate(dateTo)}`
        : `${toISODate(dateFrom)}`;
      out.push({ id: 'date', label, onRemove: () => setDateRange(undefined) });
    }
    return out;
  }, [typeFilter, exceptionsOnly, carrier, statusCategory, testedBy, packedBy, dateFrom, dateTo, techName, packerName, toggleExceptions, setCarrier, setStatus, setTestedBy, setPackedBy, setDateRange, setTypeFilter]);

  return {
    refinements,
    clearAll,
    state: {
      exceptionsOnly,
      carrier,
      statusCategory,
      typeFilter,
      testedBy,
      packedBy,
      dateFrom,
      dateTo,
      techs,
      packers
    },
    actions: {
      toggleExceptions,
      setCarrier,
      setStatus,
      setTestedBy,
      setPackedBy,
      setDateRange,
      setTypeFilter
    }
  };
}

export function ShippedFilterDropdown({ onClose }: { onClose: () => void }) {
  const { state, actions } = useShippedFilterRefinements();
  const selectClass =
    'h-9 w-full cursor-pointer appearance-none rounded-md border border-gray-200 bg-white pl-2.5 pr-7 text-caption font-semibold text-gray-900 hover:border-blue-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';
  const labelClass = 'mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500';

  const dateRange: DateRange | undefined = state.dateFrom ? { from: state.dateFrom, to: state.dateTo } : undefined;

  return (
    <div className="space-y-3">
      <NeedsAttentionButton active={state.exceptionsOnly} onClick={actions.toggleExceptions} />

      <label className="block">
        <span className={labelClass}>Type</span>
        <div className="relative">
          <select
            value={state.typeFilter}
            onChange={(e) => actions.setTypeFilter(e.target.value as ShippedTypeFilter)}
            className={selectClass}
          >
            {TYPE_ITEMS.map((t) => (
              <option key={t.id} value={String(t.id)}>{t.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        </div>
      </label>

      <div>
        <span className={labelClass}>Packed date</span>
        <DateRangePickerField
          value={dateRange}
          onChange={actions.setDateRange}
          placeholder="Any date"
        />
      </div>

      <label className="block">
        <span className={labelClass}>Carrier</span>
        <div className="relative">
          <select value={state.carrier ?? ''} onChange={(e) => actions.setCarrier((e.target.value || null) as CarrierCode | null)} className={selectClass}>
            <option value="">All carriers</option>
            {CARRIERS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        </div>
      </label>

      <label className="block">
        <span className={labelClass}>Carrier status</span>
        <div className="relative">
          <select value={state.statusCategory ?? ''} onChange={(e) => actions.setStatus((e.target.value || null) as ShipmentStatusCategory | null)} className={selectClass}>
            <option value="">All statuses</option>
            {STATUS_CATEGORIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        </div>
      </label>

      <label className="block">
        <span className={labelClass}>Tested by</span>
        <div className="relative">
          <select value={state.testedBy ?? ''} onChange={(e) => actions.setTestedBy(e.target.value ? Number(e.target.value) : null)} className={selectClass}>
            <option value="">Any tech</option>
            {state.techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        </div>
      </label>

      <label className="block">
        <span className={labelClass}>Packed by</span>
        <div className="relative">
          <select value={state.packedBy ?? ''} onChange={(e) => actions.setPackedBy(e.target.value ? Number(e.target.value) : null)} className={selectClass}>
            <option value="">Any packer</option>
            {state.packers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        </div>
      </label>

      <button
        onClick={onClose}
        className="w-full rounded-lg bg-gray-900 py-2.5 text-sm font-bold text-white transition-colors hover:bg-black"
      >
        Done
      </button>
    </div>
  );
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
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Dismiss the popover on outside click / Escape. Clicks inside a portaled
  // Radix popper (the date calendar) are NOT "outside" — ignore them.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        if (target.closest?.('[data-radix-popper-content-wrapper]')) return;
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const exceptionsOnly = readShippedExceptionsFilter(searchParams);
  const carrier = readShippedCarrierFilter(searchParams);
  const statusCategory = readShippedStatusFilter(searchParams);
  const typeFilter = readShippedTypeFilter(searchParams);
  const testedBy = parseStaffId(searchParams.get('testedBy'));
  const packedBy = parseStaffId(searchParams.get('packedBy'));
  const dateFrom = parseISODate(searchParams.get('dateFrom'));
  const dateTo = parseISODate(searchParams.get('dateTo'));
  const dateRange: DateRange | undefined = dateFrom ? { from: dateFrom, to: dateTo } : undefined;

  // Staff lists for the tester / packer dropdowns.
  const { data: techs = [] } = useQuery<StaffOption[]>({
    queryKey: ['staff', 'technician'],
    queryFn: async () => {
      const res = await fetch('/api/staff?role=technician&active=true');
      if (!res.ok) throw new Error('staff fetch failed');
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });
  const { data: packers = [] } = useQuery<StaffOption[]>({
    queryKey: ['staff', 'packer'],
    queryFn: async () => {
      const res = await fetch('/api/staff?role=packer&active=true');
      if (!res.ok) throw new Error('staff fetch failed');
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  const techName = useMemo(() => new Map(techs.map((t) => [t.id, t.name])), [techs]);
  const packerName = useMemo(() => new Map(packers.map((p) => [p.id, p.name])), [packers]);

  const replaceWith = useCallback(
    (mutator: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutator(params);
      // Any filter/view change invalidates the current page index.
      params.delete('shippedPage');
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

  const setCarrier = useCallback((next: CarrierCode | null) => {
    replaceWith((p) => { next ? p.set('carrier', next) : p.delete('carrier'); });
  }, [replaceWith]);

  const setStatus = useCallback((next: ShipmentStatusCategory | null) => {
    replaceWith((p) => { next ? p.set('statusCategory', next) : p.delete('statusCategory'); });
  }, [replaceWith]);

  const setTestedBy = useCallback((next: number | null) => {
    replaceWith((p) => { next ? p.set('testedBy', String(next)) : p.delete('testedBy'); });
  }, [replaceWith]);

  const setPackedBy = useCallback((next: number | null) => {
    replaceWith((p) => { next ? p.set('packedBy', String(next)) : p.delete('packedBy'); });
  }, [replaceWith]);

  const setDateRange = useCallback((next: DateRange | undefined) => {
    replaceWith((p) => {
      const from = toISODate(next?.from);
      const to = toISODate(next?.to ?? next?.from);
      from ? p.set('dateFrom', from) : p.delete('dateFrom');
      to ? p.set('dateTo', to) : p.delete('dateTo');
    });
  }, [replaceWith]);

  const setTypeFilter = useCallback((next: ShippedTypeFilter) => {
    replaceWith((p) => { next === 'all' ? p.delete('shippedFilter') : p.set('shippedFilter', next); });
  }, [replaceWith]);

  const clearAll = useCallback(() => {
    replaceWith((p) => {
      ['exceptions', 'carrier', 'statusCategory', 'testedBy', 'packedBy', 'dateFrom', 'dateTo'].forEach((k) => p.delete(k));
    });
  }, [replaceWith]);

  // Active refinements — Type now lives in the popover, so it counts too.
  const activeCount =
    (typeFilter !== 'all' ? 1 : 0) +
    (exceptionsOnly ? 1 : 0) + (carrier ? 1 : 0) + (statusCategory ? 1 : 0) +
    (testedBy ? 1 : 0) + (packedBy ? 1 : 0) + (dateFrom ? 1 : 0);

  const chips = useMemo(() => {
    const out: Array<{ key: string; label: string; onRemove: () => void }> = [];
    if (typeFilter !== 'all') out.push({ key: 'type', label: TYPE_LABEL.get(typeFilter) ?? typeFilter, onRemove: () => setTypeFilter('all') });
    if (exceptionsOnly) out.push({ key: 'ex', label: 'Needs attention', onRemove: toggleExceptions });
    if (carrier) out.push({ key: 'carrier', label: CARRIER_LABEL.get(carrier) ?? carrier, onRemove: () => setCarrier(null) });
    if (statusCategory) out.push({ key: 'status', label: STATUS_LABEL.get(statusCategory) ?? statusCategory, onRemove: () => setStatus(null) });
    if (testedBy) out.push({ key: 'tester', label: `Tech: ${techName.get(testedBy) ?? `#${testedBy}`}`, onRemove: () => setTestedBy(null) });
    if (packedBy) out.push({ key: 'packer', label: `Packer: ${packerName.get(packedBy) ?? `#${packedBy}`}`, onRemove: () => setPackedBy(null) });
    if (dateFrom) {
      const label = dateTo && toISODate(dateTo) !== toISODate(dateFrom)
        ? `${toISODate(dateFrom)} → ${toISODate(dateTo)}`
        : `${toISODate(dateFrom)}`;
      out.push({ key: 'date', label, onRemove: () => setDateRange(undefined) });
    }
    return out;
  }, [typeFilter, exceptionsOnly, carrier, statusCategory, testedBy, packedBy, dateFrom, dateTo, techName, packerName, toggleExceptions, setCarrier, setStatus, setTestedBy, setPackedBy, setDateRange, setTypeFilter]);

  // Legacy inline layout (deprecated toolbar) — left untouched.
  if (layout === 'inline') {
    return (
      <div className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>
        <NeedsAttentionButton active={exceptionsOnly} onClick={toggleExceptions} compact />
        <CarrierSelect value={carrier} onChange={setCarrier} />
        <StatusSelect value={statusCategory} onChange={setStatus} />
        {activeCount > 0 ? (
          <button type="button" onClick={clearAll} className="text-xs font-bold text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline">
            Clear
          </button>
        ) : null}
      </div>
    );
  }

  const selectClass =
    'h-9 w-full cursor-pointer appearance-none rounded-md border border-gray-200 bg-white pl-2.5 pr-7 text-caption font-semibold text-gray-900 hover:border-blue-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';
  const labelClass = 'mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500';

  return (
    <div className={`space-y-2 ${className ?? ''}`}>
      {/* Single filter entry point — Type (All/Orders/SKU/FBA) lives inside the
          popover alongside every other refinement (Shopify / Linear pattern). */}
      <div className="relative" ref={popoverRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-label font-bold ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
            activeCount > 0
              ? 'bg-blue-50 text-blue-700 ring-blue-200 hover:bg-blue-100'
              : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
          }`}
        >
          <Filter className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Filters</span>
          {activeCount > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-mini font-black text-white">
              {activeCount}
            </span>
          ) : null}
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open ? (
          <div
            role="dialog"
            aria-label="Shipment filters"
            className="absolute left-0 right-0 top-full z-[60] mt-1 space-y-3 rounded-xl border border-gray-200 bg-white p-3 shadow-xl ring-1 ring-black/5"
          >
            <NeedsAttentionButton active={exceptionsOnly} onClick={toggleExceptions} />

            <label className="block">
              <span className={labelClass}>Type</span>
              <div className="relative">
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as ShippedTypeFilter)}
                  className={selectClass}
                  aria-label="Shipped type filter"
                >
                  {TYPE_ITEMS.map((t) => (
                    <option key={t.id} value={String(t.id)}>{t.label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              </div>
            </label>

            <div>
              <span className={labelClass}>Packed date</span>
              <DateRangePickerField
                value={dateRange}
                onChange={setDateRange}
                placeholder="Any date"
              />
            </div>

            <label className="block">
              <span className={labelClass}>Carrier</span>
              <div className="relative">
                <select value={carrier ?? ''} onChange={(e) => setCarrier((e.target.value || null) as CarrierCode | null)} className={selectClass} aria-label="Filter by carrier">
                  <option value="">All carriers</option>
                  {CARRIERS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              </div>
            </label>

            <label className="block">
              <span className={labelClass}>Carrier status</span>
              <div className="relative">
                <select value={statusCategory ?? ''} onChange={(e) => setStatus((e.target.value || null) as ShipmentStatusCategory | null)} className={selectClass} aria-label="Filter by shipment status">
                  <option value="">All statuses</option>
                  {STATUS_CATEGORIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              </div>
            </label>

            <label className="block">
              <span className={labelClass}>Tested by</span>
              <div className="relative">
                <select value={testedBy ?? ''} onChange={(e) => setTestedBy(e.target.value ? Number(e.target.value) : null)} className={selectClass} aria-label="Filter by tester">
                  <option value="">Any tech</option>
                  {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              </div>
            </label>

            <label className="block">
              <span className={labelClass}>Packed by</span>
              <div className="relative">
                <select value={packedBy ?? ''} onChange={(e) => setPackedBy(e.target.value ? Number(e.target.value) : null)} className={selectClass} aria-label="Filter by packer">
                  <option value="">Any packer</option>
                  {packers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              </div>
            </label>

            {activeCount > 0 ? (
              <button type="button" onClick={clearAll} className="w-full text-center text-xs font-bold text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline">
                Clear filters
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Active filter chips */}
      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onRemove}
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 py-0.5 pl-2.5 pr-1.5 text-caption font-bold text-blue-700 ring-1 ring-inset ring-blue-200 transition-colors hover:bg-blue-100"
            >
              {chip.label}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
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
