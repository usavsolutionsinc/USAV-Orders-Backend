'use client';

import type { MouseEvent } from 'react';
import { ExternalLink } from '@/components/Icons';
import { IconButton } from '../primitives';

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
    <IconButton
      icon={<ExternalLink className="h-[14px] w-[14px]" />}
      onClick={handleClick}
      disabled={!canOpen}
      className={className}
      ariaLabel={ariaLabel}
      title={title}
      tone="accent"
    />
  );
}
