'use client';

import { useState, type MouseEvent, type ReactNode } from 'react';
import { Check, Copy, ExternalLink } from '@/components/Icons';
import { DetailsPanelRow } from '@/design-system/components/DetailsPanelRow';

interface CopyableValueFieldBlockProps {
  label: string;
  value: string;
  externalUrl?: string | null;
  externalLabel?: string;
  twoLineValue?: boolean;
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
        <button
          type="button"
          onClick={handleExternalClick}
          className={`transition-all text-gray-400 hover:text-blue-600 ${isFlat ? '' : 'rounded-lg p-1.5 hover:bg-white hover:shadow-sm'}`}
          title={externalLabel || 'Open in external tab'}
          aria-label={externalLabel || 'Open in external tab'}
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      )}
      {trailingActions}
      {!isEmpty && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleCopy();
          }}
          className={`transition-all ${copied ? 'opacity-100' : isFlat ? 'opacity-100' : 'opacity-0 group-hover/field:opacity-100'} ${isFlat ? '' : 'rounded-lg p-1.5 hover:bg-white hover:shadow-sm'}`}
          title={`Copy ${label}`}
          aria-label={`Copy ${label}`}
        >
          {copied ? (
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-black text-emerald-600 uppercase">Copied!</span>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
            </div>
          ) : (
            <Copy className="w-3.5 h-3.5 text-gray-400" />
          )}
        </button>
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
          className={`group/field flex items-center justify-between gap-3 px-0 py-0 transition-all ${!isEmpty ? 'cursor-pointer hover:text-gray-700' : 'cursor-default'}`}
        >
          <p
            className={`flex-1 text-sm font-bold text-gray-900 ${twoLineValue ? 'break-all leading-4' : 'truncate'} ${valueClassName || 'font-mono'}`}
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
        </div>
      </DetailsPanelRow>
    );
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{label}</span>
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
        className={`group/field flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-2.5 transition-all ${!isEmpty ? 'cursor-pointer hover:bg-gray-100 active:scale-[0.98]' : 'cursor-default'}`}
      >
        <p
          className={`flex-1 text-sm font-bold text-gray-900 ${twoLineValue ? 'break-all leading-4' : 'truncate'} ${valueClassName || 'font-mono'}`}
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
