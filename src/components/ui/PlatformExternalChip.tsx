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
  const platformLabel = getOrderPlatformLabel(orderId, accountSource) || 'UNKNOWN';

  return (
    <div className={`inline-flex w-fit items-center h-9 pl-3 pr-2 rounded-lg bg-blue-50 border border-blue-100 text-[10px] font-black text-blue-700 ${className}`}>
      <span className="font-mono uppercase">{platformLabel}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        disabled={!canOpen}
        className="ml-1 inline-flex items-center justify-center text-blue-700 disabled:text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Open external page"
        aria-label="Open external page"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

