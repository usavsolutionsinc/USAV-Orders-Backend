'use client';

import { useState, type MouseEvent } from 'react';
import { Check, Copy } from '@/components/Icons';
import { IconButton } from '../primitives';

interface CopyActionIconProps {
  value: string;
  className?: string;
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
  onCopied?: () => void;
}

export function CopyActionIcon({
  value,
  className = '',
  ariaLabel = 'Copy value',
  title = 'Copy',
  disabled = false,
  onCopied,
}: CopyActionIconProps) {
  const [copied, setCopied] = useState(false);
  const canCopy = Boolean(String(value || '').trim()) && !disabled;

  const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      onCopied?.();
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // noop
    }
  };

  return (
    <IconButton
      icon={copied ? <Check className="h-[14px] w-[14px]" /> : <Copy className="h-[14px] w-[14px]" />}
      onClick={handleClick}
      disabled={!canCopy}
      className={className}
      ariaLabel={ariaLabel}
      title={title}
      tone="neutral"
    />
  );
}
