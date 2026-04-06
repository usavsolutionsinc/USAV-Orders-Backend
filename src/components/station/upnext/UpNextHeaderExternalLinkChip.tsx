'use client';

import { ExternalLink } from '@/components/Icons';
import { chipText } from '@/design-system';

interface UpNextHeaderExternalLinkChipProps {
  label: string;
  canOpen: boolean;
  onOpen: () => void;
  ariaLabel: string;
}

export function UpNextHeaderExternalLinkChip({
  label,
  canOpen,
  onOpen,
  ariaLabel,
}: UpNextHeaderExternalLinkChipProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (canOpen) onOpen();
      }}
      disabled={!canOpen}
      aria-label={ariaLabel}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-300 px-2 text-gray-900 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-500 disabled:hover:border-gray-200 disabled:hover:bg-gray-100 disabled:hover:text-gray-500"
    >
      <span className={`${chipText} leading-none translate-y-px`}>{label}</span>
      <ExternalLink className={`h-3.5 w-3.5 ${canOpen ? 'text-blue-300' : 'text-gray-400'}`} />
    </button>
  );
}
