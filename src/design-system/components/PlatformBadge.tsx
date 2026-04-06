import { getOrderPlatformLabel, getOrderPlatformColor, getOrderPlatformBorderColor } from '@/utils/order-platform';

interface PlatformBadgeProps {
  orderId: string;
  accountSource?: string | null;
  /** When true, includes a left border accent. */
  showBorder?: boolean;
  className?: string;
}

/**
 * Renders the platform label (Amazon, eBay, ECWID, FBA, etc.) with the
 * correct color. Encapsulates the getOrderPlatformLabel + getOrderPlatformColor
 * pattern used across 10+ files.
 *
 * Returns null when no platform can be determined.
 */
export function PlatformBadge({ orderId, accountSource, showBorder = false, className = '' }: PlatformBadgeProps) {
  const label = getOrderPlatformLabel(orderId, accountSource);
  if (!label) return null;

  const textColor = getOrderPlatformColor(label);
  const borderColor = showBorder ? getOrderPlatformBorderColor(label) : '';

  return (
    <span
      className={`text-[10px] font-black uppercase tracking-wider ${textColor} ${showBorder ? `border-l-2 pl-1.5 ${borderColor}` : ''} ${className}`.trim()}
    >
      {label}
    </span>
  );
}
