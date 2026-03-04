'use client';

import { useState, type MouseEvent, type ReactNode } from 'react';
import { Check, Copy, ExternalLink } from '@/components/Icons';

interface CopyableValueFieldBlockProps {
  label: string;
  value: string;
  externalUrl?: string | null;
  externalLabel?: string;
  twoLineValue?: boolean;
  headerAccessory?: ReactNode;
  trailingActions?: ReactNode;
}

export function CopyableValueFieldBlock({
  label,
  value,
  externalUrl,
  externalLabel,
  twoLineValue = false,
  headerAccessory,
  trailingActions,
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

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{label}</span>
        {headerAccessory}
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
        className={`flex items-center justify-between gap-3 bg-gray-50 px-4 py-2.5 rounded-xl border border-gray-100 group/field transition-all ${!isEmpty ? 'cursor-pointer hover:bg-gray-100 active:scale-[0.98]' : 'cursor-default'}`}
      >
        <p
          className={`font-mono text-sm text-gray-900 font-bold flex-1 ${twoLineValue ? 'break-all leading-4' : 'truncate'}`}
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
        <div className="flex items-center gap-1.5">
          {!isEmpty && (
            <div className={`p-1.5 transition-all ${copied ? 'opacity-100' : 'opacity-0 group-hover/field:opacity-100'}`}>
              {copied ? (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-black text-emerald-600 uppercase">Copied!</span>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                </div>
              ) : (
                <Copy className="w-3.5 h-3.5 text-gray-400" />
              )}
            </div>
          )}
          {trailingActions}
          {externalUrl && (
            <button
              type="button"
              onClick={handleExternalClick}
              className="p-1.5 hover:bg-white hover:shadow-sm rounded-lg transition-all text-gray-400 hover:text-blue-600"
              title={externalLabel || 'Open in external tab'}
              aria-label={externalLabel || 'Open in external tab'}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
