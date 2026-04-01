'use client';

import { useUIModeOptional } from '../providers/UIModeProvider';
import { Check, Copy } from '@/components/Icons';

interface CopyIconButtonProps {
  copied: boolean;
  onClick: (e: React.MouseEvent) => void;
  ariaLabel?: string;
}

export function CopyIconButton({ copied, onClick, ariaLabel }: CopyIconButtonProps) {
  const { isMobile } = useUIModeOptional();
  const Icon = copied ? Check : Copy;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-shrink-0 transition-colors ${
        isMobile
          ? 'h-11 w-11 flex items-center justify-center text-gray-400 active:text-emerald-600 active:scale-95 transition-transform'
          : 'text-gray-400 hover:text-emerald-600'
      }`}
      aria-label={ariaLabel ?? (copied ? 'Copied' : 'Copy')}
    >
      <Icon className={isMobile ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
    </button>
  );
}
