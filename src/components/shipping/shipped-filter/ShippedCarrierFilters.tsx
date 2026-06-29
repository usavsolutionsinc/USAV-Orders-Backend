import { useMemo, useRef, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { ChevronDown, Filter, X } from '@/components/Icons';
import { AnchoredLayer } from '@/design-system';
import { DateRangePickerField } from '@/design-system/components/DateRangePickerField';
import type { CarrierCode, ShipmentStatusCategory } from '@/components/shipping/ShipmentStatusBadge';
import { CARRIERS, CARRIER_LABEL, STATUS_CATEGORIES, STATUS_LABEL, TYPE_ITEMS, TYPE_LABEL, type ShippedTypeFilter } from './shipped-filter-constants';
import { toISODate } from './shipped-filter-params';
import { useShippedFilterActions } from './useShippedFilterActions';
import { useStaffOptions } from './useStaffOptions';
import { CarrierSelect, NeedsAttentionButton, StatusSelect } from './ShippedFilterControls';

const selectClass =
  'h-9 w-full cursor-pointer appearance-none rounded-md border border-gray-200 bg-white pl-2.5 pr-7 text-caption font-semibold text-gray-900 hover:border-blue-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';
const labelClass = 'mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500';

export function ShippedCarrierFilters({
  className,
  basePath,
  layout = 'sidebar',
}: {
  className?: string;
  basePath?: string;
  layout?: 'sidebar' | 'inline';
}) {
  const [open, setOpen] = useState(false);
  // Anchor for the portaled filter popover (AnchoredLayer pins to this wrapper).
  const popoverRef = useRef<HTMLDivElement>(null);

  const a = useShippedFilterActions(basePath);
  const { techs, packers } = useStaffOptions();
  const techName = useMemo(() => new Map(techs.map((t) => [t.id, t.name])), [techs]);
  const packerName = useMemo(() => new Map(packers.map((p) => [p.id, p.name])), [packers]);

  const { exceptionsOnly, carrier, statusCategory, typeFilter, testedBy, packedBy, dateFrom, dateTo, dateRange, clearAll } = a;

  // Active refinements — Type now lives in the popover, so it counts too.
  const activeCount =
    (typeFilter !== 'all' ? 1 : 0) +
    (exceptionsOnly ? 1 : 0) + (carrier ? 1 : 0) + (statusCategory ? 1 : 0) +
    (testedBy ? 1 : 0) + (packedBy ? 1 : 0) + (dateFrom ? 1 : 0);

  const chips = useMemo(() => {
    const out: Array<{ key: string; label: string; onRemove: () => void }> = [];
    if (typeFilter !== 'all') out.push({ key: 'type', label: TYPE_LABEL.get(typeFilter) ?? typeFilter, onRemove: () => a.setTypeFilter('all') });
    if (exceptionsOnly) out.push({ key: 'ex', label: 'Needs attention', onRemove: a.toggleExceptions });
    if (carrier) out.push({ key: 'carrier', label: CARRIER_LABEL.get(carrier) ?? carrier, onRemove: () => a.setCarrier(null) });
    if (statusCategory) out.push({ key: 'status', label: STATUS_LABEL.get(statusCategory) ?? statusCategory, onRemove: () => a.setStatus(null) });
    if (testedBy) out.push({ key: 'tester', label: `Tech: ${techName.get(testedBy) ?? `#${testedBy}`}`, onRemove: () => a.setTestedBy(null) });
    if (packedBy) out.push({ key: 'packer', label: `Packer: ${packerName.get(packedBy) ?? `#${packedBy}`}`, onRemove: () => a.setPackedBy(null) });
    if (dateFrom) {
      const label = dateTo && toISODate(dateTo) !== toISODate(dateFrom)
        ? `${toISODate(dateFrom)} → ${toISODate(dateTo)}`
        : `${toISODate(dateFrom)}`;
      out.push({ key: 'date', label, onRemove: () => a.setDateRange(undefined) });
    }
    return out;
  }, [typeFilter, exceptionsOnly, carrier, statusCategory, testedBy, packedBy, dateFrom, dateTo, techName, packerName, a]);

  // Legacy inline layout (deprecated toolbar).
  if (layout === 'inline') {
    return (
      <div className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>
        <NeedsAttentionButton active={exceptionsOnly} onClick={a.toggleExceptions} compact />
        <CarrierSelect value={carrier} onChange={a.setCarrier} />
        <StatusSelect value={statusCategory} onChange={a.setStatus} />
        {activeCount > 0 ? (
          // ds-raw-button: minimal inline text link with hover:underline, not a DS Button control
          <button type="button" onClick={clearAll} className="text-xs font-bold text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline">
            Clear
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className ?? ''}`}>
      {/* Single filter entry point — Type (All/Orders/SKU/FBA) lives inside the
          popover alongside every other refinement (Shopify / Linear pattern). */}
      <div className="relative" ref={popoverRef}>
        {/* ds-raw-button: popover trigger (aria-haspopup dialog) with conditional active fill + count badge + chevron, not a DS variant */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-label font-bold ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
            activeCount > 0 ? 'bg-blue-50 text-blue-700 ring-blue-200 hover:bg-blue-100' : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
          }`}
        >
          <Filter className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Filters</span>
          {activeCount > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-mini font-black text-white">{activeCount}</span>
          ) : null}
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        <AnchoredLayer
          open={open}
          onClose={() => setOpen(false)}
          anchorRef={popoverRef}
          placement="bottom-stretch"
          gap={4}
          ignoreClickSelector="[data-radix-popper-content-wrapper]"
        >
          <div role="dialog" aria-label="Shipment filters" className="space-y-3 rounded-xl border border-gray-200 bg-white p-3 shadow-xl ring-1 ring-black/5">
            <NeedsAttentionButton active={exceptionsOnly} onClick={a.toggleExceptions} />

            <label className="block">
              <span className={labelClass}>Type</span>
              <div className="relative">
                <select value={typeFilter} onChange={(e) => a.setTypeFilter(e.target.value as ShippedTypeFilter)} className={selectClass} aria-label="Shipped type filter">
                  {TYPE_ITEMS.map((t) => (
                    <option key={t.id} value={String(t.id)}>{t.label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              </div>
            </label>

            <div>
              <span className={labelClass}>Packed date</span>
              <DateRangePickerField value={dateRange as DateRange | undefined} onChange={a.setDateRange} placeholder="Any date" />
            </div>

            <label className="block">
              <span className={labelClass}>Carrier</span>
              <div className="relative">
                <select value={carrier ?? ''} onChange={(e) => a.setCarrier((e.target.value || null) as CarrierCode | null)} className={selectClass} aria-label="Filter by carrier">
                  <option value="">All carriers</option>
                  {CARRIERS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              </div>
            </label>

            <label className="block">
              <span className={labelClass}>Carrier status</span>
              <div className="relative">
                <select value={statusCategory ?? ''} onChange={(e) => a.setStatus((e.target.value || null) as ShipmentStatusCategory | null)} className={selectClass} aria-label="Filter by shipment status">
                  <option value="">All statuses</option>
                  {STATUS_CATEGORIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              </div>
            </label>

            <label className="block">
              <span className={labelClass}>Tested by</span>
              <div className="relative">
                <select value={testedBy ?? ''} onChange={(e) => a.setTestedBy(e.target.value ? Number(e.target.value) : null)} className={selectClass} aria-label="Filter by tester">
                  <option value="">Any tech</option>
                  {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              </div>
            </label>

            <label className="block">
              <span className={labelClass}>Packed by</span>
              <div className="relative">
                <select value={packedBy ?? ''} onChange={(e) => a.setPackedBy(e.target.value ? Number(e.target.value) : null)} className={selectClass} aria-label="Filter by packer">
                  <option value="">Any packer</option>
                  {packers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              </div>
            </label>

            {activeCount > 0 ? (
              // ds-raw-button: minimal inline text link with hover:underline, not a DS Button control
              <button type="button" onClick={clearAll} className="w-full text-center text-xs font-bold text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline">
                Clear filters
              </button>
            ) : null}
          </div>
        </AnchoredLayer>
      </div>

      {/* Active filter chips */}
      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            // ds-raw-button: removable active-filter pill chip (label + embedded X), not a standard action button
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
