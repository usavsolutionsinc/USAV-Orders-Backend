'use client';

import { useState, type MouseEvent, type ReactNode } from 'react';
import { Check, Copy, ExternalLink } from '@/components/Icons';
import { DetailsPanelRow } from '@/design-system/components/DetailsPanelRow';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';

interface CopyableValueFieldBlockProps {
  label: string;
  value: string;
  externalUrl?: string | null;
  externalLabel?: string;
  twoLineValue?: boolean;
  noTruncate?: boolean;
  headerAccessory?: ReactNode;
  trailingActions?: ReactNode;
  variant?: 'card' | 'flat';
  valueClassName?: string;
  keepBottomDivider?: boolean;
}

export function CopyableValueFieldBlock({
  label,
  value,
  externalUrl,
  externalLabel,
  twoLineValue = false,
  noTruncate = false,
  headerAccessory,
  trailingActions,
  variant = 'card',
  valueClassName,
  keepBottomDivider = false,
}: CopyableValueFieldBlockProps) {
  const [copied, setCopied] = useState(false);
  const isEmpty = !value || value === 'Not available' || value === 'N/A';

  const handleCopy = () => {
    if (isEmpty) return;
    navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleExternalClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (externalUrl) {
      window.open(externalUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const isFlat = variant === 'flat';
  const rowActions = (
    <div className="flex items-center gap-1.5">
      {externalUrl && (
        <HoverTooltip label={externalLabel || 'Open in external tab'} asChild focusable={false}>
          <IconButton
            onClick={handleExternalClick}
            ariaLabel={externalLabel || 'Open in external tab'}
            tone="accent"
            icon={<ExternalLink className="w-3.5 h-3.5" />}
            className={`transition-all text-text-faint ${isFlat ? '' : 'rounded-lg p-1.5 hover:bg-surface-card hover:shadow-sm'}`}
          />
        </HoverTooltip>
      )}
      {trailingActions}
      {!isEmpty && (
        <HoverTooltip label={`Copy ${label}`} asChild focusable={false}>
          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              handleCopy();
            }}
            ariaLabel={`Copy ${label}`}
            className={`transition-all ${copied ? 'opacity-100' : isFlat ? 'opacity-100' : 'opacity-0 group-hover/field:opacity-100'} ${isFlat ? '' : 'rounded-lg p-1.5 hover:bg-surface-card hover:shadow-sm'}`}
            icon={copied ? (
              <div className="flex items-center gap-1">
                <span className="text-micro font-black text-emerald-600 uppercase">Copied!</span>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              </div>
            ) : (
              <Copy className="w-3.5 h-3.5 text-text-faint" />
            )}
          />
        </HoverTooltip>
      )}
    </div>
  );

  if (isFlat) {
    return (
      <DetailsPanelRow
        label={label}
        headerAccessory={headerAccessory}
        actions={rowActions}
        className={keepBottomDivider ? '' : 'last:border-b-0'}
      >
        <div
          onClick={handleCopy}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleCopy();
            }
          }}
          tabIndex={isEmpty ? -1 : 0}
          role="button"
          aria-label={`Copy ${label}: ${value}`}
          className={`group/field flex items-center justify-between gap-3 px-0 py-0 transition-all ${!isEmpty ? 'cursor-pointer hover:text-text-muted' : 'cursor-default'}`}
        >
          <p
            className={`flex-1 text-sm font-bold text-text-default ${noTruncate ? 'whitespace-normal break-words leading-snug' : twoLineValue ? 'break-all leading-4' : 'truncate'} ${valueClassName || 'font-mono'}`}
            style={
              !noTruncate && twoLineValue
                ? {
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }
                : undefined
            }
          >
            {value}
          </p>
        </div>
      </DetailsPanelRow>
    );
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-micro text-text-faint font-black uppercase tracking-widest">{label}</span>
          {headerAccessory}
        </div>
      </div>
      <div
        onClick={handleCopy}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleCopy();
          }
        }}
        tabIndex={isEmpty ? -1 : 0}
        role="button"
        aria-label={`Copy ${label}: ${value}`}
        className={`group/field flex items-center justify-between gap-3 rounded-xl border border-border-hairline bg-surface-canvas px-4 py-2.5 transition-all ${!isEmpty ? 'cursor-pointer hover:bg-surface-sunken active:scale-[0.98]' : 'cursor-default'}`}
      >
        <p
          className={`flex-1 text-sm font-bold text-text-default ${twoLineValue ? 'break-all leading-4' : 'truncate'} ${valueClassName || 'font-mono'}`}
          style={
            twoLineValue
              ? {
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }
              : undefined
          }
        >
          {value}
        </p>
        {rowActions}
      </div>
    </div>
  );
}
