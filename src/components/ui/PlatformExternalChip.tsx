'use client';

import { ExternalLink } from '@/components/Icons';
import { getOrderPlatformLabel } from '@/utils/order-platform';

interface PlatformExternalChipProps {
  orderId: string;
  accountSource?: string | null;
  canOpen: boolean;
  onOpen: () => void;
  className?: string;
}

export function PlatformExternalChip({
  orderId,
  accountSource,
  canOpen,
  onOpen,
  className = '',
}: PlatformExternalChipProps) {
  const platformLabel = getOrderPlatformLabel(orderId, accountSource) || 'External';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (canOpen) onOpen();
      }}
      disabled={!canOpen}
      title={platformLabel}
      aria-label={`Open on ${platformLabel}`}
      className={`inline-flex items-center justify-center h-8 w-8 rounded-lg bg-blue-50 border border-blue-100 text-blue-600 hover:bg-blue-100 hover:border-blue-200 disabled:text-gray-300 disabled:bg-gray-50 disabled:border-gray-100 disabled:cursor-not-allowed transition-colors ${className}`}
    >
      <ExternalLink className="w-3.5 h-3.5" />
    </button>
  );
}
