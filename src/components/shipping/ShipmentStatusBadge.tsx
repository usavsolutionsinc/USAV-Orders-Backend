'use client';

import { useMemo } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { AlertTriangle, Truck, Package, PackageCheck, RotateCcw, Clock, Check } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

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

const CATEGORY_STYLE: Record<ShipmentStatusCategory, { cls: string; text: string; icon: React.FC<{ className?: string }>; label: string }> = {
  LABEL_CREATED:    { cls: 'bg-gray-100 text-gray-700',       text: 'text-gray-500',    icon: Package,      label: 'label created' },
  ACCEPTED:         { cls: 'bg-blue-50 text-blue-700',        text: 'text-blue-500',    icon: Truck,        label: 'accepted' },
  IN_TRANSIT:       { cls: 'bg-blue-100 text-blue-800',       text: 'text-blue-600',    icon: Truck,        label: 'in transit' },
  OUT_FOR_DELIVERY: { cls: 'bg-amber-100 text-amber-900',     text: 'text-amber-600',   icon: Truck,        label: 'out for delivery' },
  DELIVERED:        { cls: 'bg-emerald-100 text-emerald-800', text: 'text-emerald-600', icon: PackageCheck, label: 'delivered' },
  EXCEPTION:        { cls: 'bg-rose-100 text-rose-800',       text: 'text-rose-600',    icon: AlertTriangle, label: 'exception' },
  RETURNED:         { cls: 'bg-purple-100 text-purple-800',   text: 'text-purple-600',  icon: RotateCcw,    label: 'returned' },
  UNKNOWN:          { cls: 'bg-gray-50 text-gray-500',        text: 'text-gray-400',    icon: Clock,        label: 'unknown' },
};

function normalizeCategory(value: string | null | undefined): ShipmentStatusCategory {
  const upper = String(value ?? '').toUpperCase();
  return (upper in CATEGORY_STYLE ? upper : 'UNKNOWN') as ShipmentStatusCategory;
}

/** Carrier categories that carry no real signal — not worth a row icon. */
const SILENT_CATEGORIES = new Set<ShipmentStatusCategory>(['UNKNOWN']);

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
      <HoverTooltip label={description ?? style.label} asChild>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${style.cls}`}
        >
          <Icon className="h-3 w-3" />
          {carrierLabel ? `${carrierLabel} · ` : ''}
          {style.label}
        </span>
      </HoverTooltip>

      {(exceptionShown || stalled) && (
        <HoverTooltip
          label={
            exceptionShown
              ? description || 'Carrier reported an exception'
              : `No carrier scan in ${stallHours}h+`
          }
          asChild
        >
          <span
            className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-white"
          >
            <AlertTriangle className="h-3 w-3" />
            {exceptionShown ? 'Exception' : 'Stalled'}
          </span>
        </HoverTooltip>
      )}

      {relative && (
        <HoverTooltip label={latestEventAt ?? ''} asChild>
          <span className="whitespace-nowrap text-caption text-gray-500">
            {relative}
            {loc ? ` · ${loc}` : ''}
          </span>
        </HoverTooltip>
      )}
    </div>
  );
}

export interface CarrierStatusIconProps {
  carrier?: CarrierCode | string | null;
  category?: ShipmentStatusCategory | string | null;
  /** Carrier-supplied label (latest_status_label); falls back to the category label. */
  statusLabel?: string | null;
  description?: string | null;
  latestEventAt?: string | null;
  hasException?: boolean | null;
  isTerminal?: boolean | null;
  /** Hours since last event before non-terminal shipments count as stalled. Defaults to 72. */
  stallHours?: number;
  className?: string;
}

/**
 * Compact, icon-only carrier-status indicator for dense table rows — reuses the
 * same per-category icon + color map as {@link ShipmentStatusBadge} so the row
 * glyph and the detail badge always agree. Renders nothing when there is no
 * real signal (no carrier and an UNKNOWN status), keeping rows clean. A carrier
 * exception (or a stalled, non-terminal shipment) overrides to the rose
 * AlertTriangle so problems read the same everywhere. The full status + carrier
 * + relative time live in the hover tooltip / aria-label (never color alone).
 */
export function CarrierStatusIcon({
  carrier,
  category,
  statusLabel,
  description,
  latestEventAt,
  hasException,
  isTerminal,
  stallHours = 72,
  className,
}: CarrierStatusIconProps) {
  const normalizedCategory = normalizeCategory(category);
  const hasSignal = Boolean(carrier) || !SILENT_CATEGORIES.has(normalizedCategory);
  if (!hasSignal) return null;

  // Delivered is the terminal truth: it overrides every other state — a carrier
  // exception flag, a stalled timer, even a scanned-out package — because it is
  // always the last update. Delivered renders as a solid dot rather than a glyph.
  const delivered = normalizedCategory === 'DELIVERED' || (isTerminal === true && normalizedCategory !== 'RETURNED');
  const stalled = !delivered && isStalled({ isTerminal, category: normalizedCategory, latestEventAt, stallHours });
  const isProblem = !delivered && (Boolean(hasException) || normalizedCategory === 'EXCEPTION' || stalled);

  const style = delivered
    ? CATEGORY_STYLE.DELIVERED
    : isProblem
      ? CATEGORY_STYLE.EXCEPTION
      : CATEGORY_STYLE[normalizedCategory];
  const Icon = style.icon;

  const carrierLabel = carrier ? String(carrier).toUpperCase() : null;
  const baseLabel = delivered
    ? 'delivered'
    : isProblem
      ? (stalled && !hasException && normalizedCategory !== 'EXCEPTION' ? 'stalled' : 'exception')
      : (statusLabel?.trim() || style.label);

  let relative: string | null = null;
  if (latestEventAt) {
    const d = new Date(latestEventAt);
    if (Number.isFinite(d.getTime())) relative = formatDistanceToNowStrict(d, { addSuffix: true });
  }

  const tooltip = [carrierLabel, baseLabel, relative].filter(Boolean).join(' · ')
    || description || baseLabel;

  return (
    <HoverTooltip
      label={tooltip}
      className={`inline-flex shrink-0 items-center ${className ?? ''}`.trim()}
    >
      {delivered ? (
        <Check
          className="h-3.5 w-3.5 shrink-0 text-emerald-500"
          aria-label={`Carrier status: ${tooltip}`}
        />
      ) : (
        <Icon className={`h-3.5 w-3.5 ${style.text}`} aria-label={`Carrier status: ${tooltip}`} />
      )}
    </HoverTooltip>
  );
}
