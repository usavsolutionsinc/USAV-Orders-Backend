'use client';

import { AlertTriangle, Hash, Clock, Inbox, Truck, MapPin, Unlink, Lock } from '@/components/Icons';
import { IconWithTooltip } from '@/components/ui/IconWithTooltip';

/**
 * Faceted receiving delivery state → a single compact icon with a hover/a11y
 * label, replacing the long text suffixes (STALLED / NO TRACKING # / PENDING
 * CARRIER …) that used to push the receiving row wide and never aligned.
 *
 * Keyed by `ReceivingLineRow.delivery_state` (computed for `view=incoming`).
 * Uses IconWithTooltip for a portal-based hover label.
 */
const DELIVERY_STATE_ICON = {
  STALLED: { Icon: AlertTriangle, tone: 'text-orange-600', label: 'Stalled — no carrier movement, needs attention' },
  AWAITING_TRACKING: { Icon: Hash, tone: 'text-gray-400', label: 'No tracking number on file' },
  PENDING_CARRIER: { Icon: Clock, tone: 'text-sky-500', label: 'Pending carrier pickup' },
  DELIVERED_UNOPENED: { Icon: Inbox, tone: 'text-rose-600', label: 'Delivered but not scanned in yet' },
  ARRIVING_TODAY: { Icon: Truck, tone: 'text-amber-600', label: 'Arriving today' },
  IN_TRANSIT: { Icon: MapPin, tone: 'text-blue-600', label: 'In transit' },
  TRACKING_UNAVAILABLE: {
    Icon: Lock,
    tone: 'text-violet-600',
    label: 'Carrier tracking unavailable (access blocked) — delivered status unobtainable',
  },
  CARRIER_MISMATCH: {
    Icon: Unlink,
    tone: 'text-red-600',
    label: 'Carrier mismatch — the carrier/number don’t match (no known carrier, or no record at the carrier)',
  },
} as const;

type KnownState = keyof typeof DELIVERY_STATE_ICON;

export function DeliveryStateIcon({
  state,
  className,
}: {
  state: string | null | undefined;
  className?: string;
}) {
  const meta = state ? DELIVERY_STATE_ICON[state as KnownState] : undefined;
  if (!meta) return null;
  const { Icon, tone, label } = meta;

  return (
    <IconWithTooltip
      Icon={Icon}
      label={label}
      iconClassName={tone}
      className={className}
    />
  );
}
