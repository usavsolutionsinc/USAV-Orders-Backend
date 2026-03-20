'use client';

import type { MouseEvent } from 'react';
import { ExternalLink } from '@/components/Icons';

interface ExternalLinkActionIconProps {
  href?: string | null;
  onOpen?: () => void;
  className?: string;
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
}

export function ExternalLinkActionIcon({
  href,
  onOpen,
  className = '',
  ariaLabel = 'Open external link',
  title = 'Open',
  disabled = false,
}: ExternalLinkActionIconProps) {
  const canOpen = Boolean(href || onOpen) && !disabled;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!canOpen) return;
    if (onOpen) {
      onOpen();
      return;
    }
    if (href) window.open(href, '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!canOpen}
      className={`text-slate-400 transition-colors duration-100 ease-out hover:text-blue-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 ${className}`.trim()}
      aria-label={ariaLabel}
      title={title}
    >
      <ExternalLink className="h-[14px] w-[14px]" />
    </button>
  );
}
