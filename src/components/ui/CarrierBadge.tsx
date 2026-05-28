'use client';

/**
 * Small carrier-coded badge with a click-through to the carrier's tracking
 * page. Renders next to a TrackingChip so operators can tell at a glance
 * which carrier the row's tracking# belongs to AND deep-link to the
 * carrier site in a new tab without leaving the table.
 *
 * Carriers + tones intentionally subtle so a long table doesn't shout:
 *   UPS   — brown / bronze (#7a4a17 family)
 *   FedEx — purple
 *   USPS  — sky blue
 *   DHL   — yellow / red
 *   other — slate
 */

const CARRIER_STYLE: Record<
  string,
  { label: string; bg: string; text: string; ring: string; href: (t: string) => string }
> = {
  UPS: {
    label: 'UPS',
    bg: 'bg-amber-900/10',
    text: 'text-amber-900',
    ring: 'ring-amber-800/30',
    href: (t) => `https://www.ups.com/track?track=yes&trackNums=${encodeURIComponent(t)}&loc=en_US`,
  },
  FEDEX: {
    label: 'FDX',
    bg: 'bg-violet-50',
    text: 'text-violet-700',
    ring: 'ring-violet-300',
    href: (t) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(t)}`,
  },
  USPS: {
    label: 'PS',
    bg: 'bg-sky-50',
    text: 'text-sky-700',
    ring: 'ring-sky-300',
    href: (t) => `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${encodeURIComponent(t)}`,
  },
  DHL: {
    label: 'DHL',
    bg: 'bg-yellow-50',
    text: 'text-yellow-800',
    ring: 'ring-yellow-300',
    href: (t) => `https://www.dhl.com/en/express/tracking.html?AWB=${encodeURIComponent(t)}&brand=DHL`,
  },
};

export interface CarrierBadgeProps {
  /** Carrier code from `shipping_tracking_numbers.carrier` (UPS / FEDEX / USPS / DHL / UNKNOWN). */
  carrier: string | null | undefined;
  /** Raw tracking number to build the deep link. */
  trackingNumber: string | null | undefined;
}

/**
 * Returns null when the carrier is unknown / unsupported so callers can
 * fall back to no badge rather than rendering a sad gray pill.
 */
export function CarrierBadge({ carrier, trackingNumber }: CarrierBadgeProps) {
  const code = String(carrier || '').toUpperCase();
  const tracking = String(trackingNumber || '').trim();
  const style = CARRIER_STYLE[code];
  if (!style || !tracking) return null;

  return (
    <a
      href={style.href(tracking)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`Open ${style.label} tracking in a new tab`}
      className={`inline-flex h-5 shrink-0 items-center justify-center rounded px-1.5 text-eyebrow font-black uppercase tracking-wider ring-1 ring-inset transition-colors hover:brightness-110 ${style.bg} ${style.text} ${style.ring}`}
    >
      {style.label}
    </a>
  );
}
