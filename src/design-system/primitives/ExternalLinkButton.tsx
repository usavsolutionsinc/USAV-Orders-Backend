'use client';

import { useUIModeOptional } from '../providers/UIModeProvider';
import { ExternalLink } from '@/components/Icons';

interface ExternalLinkButtonProps {
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export function ExternalLinkButton({ onClick, disabled = false, ariaLabel }: ExternalLinkButtonProps) {
  const { isMobile } = useUIModeOptional();

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex-shrink-0 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        isMobile
          ? 'h-11 w-11 flex items-center justify-center text-gray-400 active:text-emerald-600 active:scale-95 transition-transform'
          : 'text-gray-400 hover:text-emerald-600'
      }`}
      aria-label={ariaLabel ?? 'Open in external tab'}
    >
      <ExternalLink className={isMobile ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
    </button>
  );
}
