import { AlertTriangle, Truck } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import type { CarrierCode, ShipmentStatusCategory } from '@/components/shipping/ShipmentStatusBadge';
import { CARRIERS, STATUS_CATEGORIES } from './shipped-filter-constants';

export function NeedsAttentionButton({
  active,
  onClick,
  compact = false,
}: {
  active: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <HoverTooltip label="Show only shipments with a carrier exception or no scan in >72h" asChild>
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        compact
          ? `ds-raw-button inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 ${
              active ? 'bg-rose-600 text-white ring-rose-600 hover:bg-rose-700' : 'bg-white text-rose-700 ring-rose-200 hover:bg-rose-50'
            }`
          : `ds-raw-button flex w-full items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-label font-bold ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 focus:ring-rose-500/40 ${
              active ? 'bg-rose-600 text-white ring-rose-600 hover:bg-rose-700' : 'bg-white text-rose-700 ring-rose-200 hover:bg-rose-50'
            }`
      }
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      Needs attention
    </button>
    </HoverTooltip>
  );
}

export function CarrierSelect({ value, onChange }: { value: CarrierCode | null; onChange: (next: CarrierCode | null) => void }) {
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
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
    </label>
  );
}

export function StatusSelect({ value, onChange }: { value: ShipmentStatusCategory | null; onChange: (next: ShipmentStatusCategory | null) => void }) {
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
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
    </label>
  );
}
