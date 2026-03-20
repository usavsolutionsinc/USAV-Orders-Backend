'use client';

import { useState, type MouseEvent } from 'react';
import { Check, Copy } from '@/components/Icons';

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
    <button
      type="button"
      onClick={handleClick}
      disabled={!canCopy}
      className={`text-slate-400 transition-colors duration-100 ease-out hover:text-slate-900 active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 ${className}`.trim()}
      aria-label={ariaLabel}
      title={title}
    >
      {copied ? <Check className="h-[14px] w-[14px]" /> : <Copy className="h-[14px] w-[14px]" />}
    </button>
  );
}
