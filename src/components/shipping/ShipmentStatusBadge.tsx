'use client';

import { useMemo } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { AlertTriangle, Truck, Package, PackageCheck, RotateCcw, Clock } from '@/components/Icons';

export type ShipmentStatusCategory =
  | 'LABEL_CREATED'
  | 'ACCEPTED'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'EXCEPTION'
  | 'RETURNED'
  | 'UNKNOWN';

export type CarrierCode = 'UPS' | 'USPS' | 'FEDEX';

export interface ShipmentStatusBadgeProps {
  carrier?: CarrierCode | string | null;
  category?: ShipmentStatusCategory | string | null;
  description?: string | null;
  latestEventAt?: string | null;
  city?: string | null;
  state?: string | null;
  hasException?: boolean | null;
  isTerminal?: boolean | null;
  /** Hours since last event before non-terminal shipments count as stalled. Defaults to 72. */
  stallHours?: number;
  className?: string;
}

const CATEGORY_STYLE: Record<ShipmentStatusCategory, { cls: string; icon: React.FC<{ className?: string }>; label: string }> = {
  LABEL_CREATED:    { cls: 'bg-gray-100 text-gray-700',       icon: Package,      label: 'label created' },
  ACCEPTED:         { cls: 'bg-blue-50 text-blue-700',        icon: Truck,        label: 'accepted' },
  IN_TRANSIT:       { cls: 'bg-blue-100 text-blue-800',       icon: Truck,        label: 'in transit' },
  OUT_FOR_DELIVERY: { cls: 'bg-amber-100 text-amber-900',     icon: Truck,        label: 'out for delivery' },
  DELIVERED:        { cls: 'bg-emerald-100 text-emerald-800', icon: PackageCheck, label: 'delivered' },
  EXCEPTION:        { cls: 'bg-rose-100 text-rose-800',       icon: AlertTriangle, label: 'exception' },
  RETURNED:         { cls: 'bg-purple-100 text-purple-800',   icon: RotateCcw,    label: 'returned' },
  UNKNOWN:          { cls: 'bg-gray-50 text-gray-500',        icon: Clock,        label: 'unknown' },
};

function normalizeCategory(value: string | null | undefined): ShipmentStatusCategory {
  const upper = String(value ?? '').toUpperCase();
  return (upper in CATEGORY_STYLE ? upper : 'UNKNOWN') as ShipmentStatusCategory;
}

export function isStalled(args: {
  isTerminal?: boolean | null;
  category?: ShipmentStatusCategory | string | null;
  latestEventAt?: string | null;
  stallHours?: number;
}): boolean {
  if (args.isTerminal) return false;
  const cat = normalizeCategory(args.category);
  if (cat === 'DELIVERED') return false;
  if (!args.latestEventAt) return false;
  const ms = Date.now() - new Date(args.latestEventAt).getTime();
  if (!Number.isFinite(ms)) return false;
  return ms > (args.stallHours ?? 72) * 3_600_000;
}

export function ShipmentStatusBadge({
  carrier,
  category,
  description,
  latestEventAt,
  city,
  state,
  hasException,
  isTerminal,
  stallHours = 72,
  className,
}: ShipmentStatusBadgeProps) {
  const normalizedCategory = normalizeCategory(category);
  const style = CATEGORY_STYLE[normalizedCategory];
  const Icon = style.icon;

  const stalled = useMemo(
    () => isStalled({ isTerminal, category: normalizedCategory, latestEventAt, stallHours }),
    [isTerminal, normalizedCategory, latestEventAt, stallHours],
  );

  const carrierLabel = carrier ? String(carrier).toUpperCase() : null;
  const relative = useMemo(() => {
    if (!latestEventAt) return null;
    const d = new Date(latestEventAt);
    if (!Number.isFinite(d.getTime())) return null;
    return formatDistanceToNowStrict(d, { addSuffix: true });
  }, [latestEventAt]);

  const loc = [city, state].filter(Boolean).join(', ');
  const exceptionShown = Boolean(hasException) || normalizedCategory === 'EXCEPTION' || normalizedCategory === 'RETURNED';

  return (
    <div className={`inline-flex flex-wrap items-center gap-1.5 ${className ?? ''}`}>
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${style.cls}`}
        title={description ?? style.label}
      >
        <Icon className="h-3 w-3" />
        {carrierLabel ? `${carrierLabel} · ` : ''}
        {style.label}
      </span>

      {(exceptionShown || stalled) && (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
          title={
            exceptionShown
              ? description || 'Carrier reported an exception'
              : `No carrier scan in ${stallHours}h+`
          }
        >
          <AlertTriangle className="h-3 w-3" />
          {exceptionShown ? 'Exception' : 'Stalled'}
        </span>
      )}

      {relative && (
        <span className="whitespace-nowrap text-[11px] text-gray-500" title={latestEventAt ?? undefined}>
          {relative}
          {loc ? ` · ${loc}` : ''}
        </span>
      )}
    </div>
  );
}
