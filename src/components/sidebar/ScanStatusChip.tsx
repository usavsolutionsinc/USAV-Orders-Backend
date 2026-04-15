'use client';

import { useState } from 'react';
import { RefreshCw, X } from '@/components/Icons';
import { TrackingChip, getLast4 } from '@/components/ui/CopyChip';

export type ScanStatus = 'checking' | 'matched' | 'unmatched' | 'error';

export type ScanStatusChipProps = {
  tracking: string;
  status: ScanStatus;
  errorMessage?: string;
  exceptionId?: number | null;
  exceptionReason?: string | null;
  onRetry?: () => void;
  onRefetch?: () => Promise<void> | void;
  onDismiss?: () => void;
};

const LABELS: Record<ScanStatus, string> = {
  checking: 'Checking Zoho…',
  matched: 'PO loaded',
  unmatched: 'No PO · logged',
  error: 'Retry?',
};

const DOT_CLASS: Record<ScanStatus, string> = {
  checking: 'bg-blue-400 animate-pulse',
  matched: 'bg-emerald-500',
  unmatched: 'bg-amber-400',
  error: 'bg-red-500',
};

const LABEL_CLASS: Record<ScanStatus, string> = {
  checking: 'text-blue-600',
  matched: 'text-emerald-700',
  unmatched: 'text-amber-700',
  error: 'text-red-600',
};

export function ScanStatusChip({
  tracking,
  status,
  errorMessage,
  exceptionId,
  exceptionReason,
  onRetry,
  onRefetch,
  onDismiss,
}: ScanStatusChipProps) {
  const [refetching, setRefetching] = useState(false);
  const label = status === 'error' && errorMessage ? errorMessage : LABELS[status];

  // Show the refetch button on terminal non-error states — scans that landed
  // "unmatched" can be re-pinged once Zoho has the PO, and scans that matched
  // can be forced to re-import lines (e.g. after truncation).
  const canRefetch = !!onRefetch && (status === 'unmatched' || status === 'matched');

  const handleRefetch = async () => {
    if (!onRefetch || refetching) return;
    setRefetching(true);
    try { await onRefetch(); } finally { setRefetching(false); }
  };

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[status]}`} />
        <TrackingChip value={tracking} display={getLast4(tracking)} />
        <span
          className={`text-[9px] font-black uppercase tracking-widest truncate ${LABEL_CLASS[status]}`}
        >
          {label}
        </span>
        {status === 'unmatched' && exceptionId ? (
          <a
            href={`/tracking-exceptions?q=${encodeURIComponent(tracking)}`}
            target="_blank"
            rel="noreferrer"
            title={exceptionReason ? `Queued #${exceptionId} · ${exceptionReason}` : `Queued #${exceptionId}`}
            className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-amber-700 ring-1 ring-amber-200 hover:bg-amber-200"
          >
            #{exceptionId}
          </a>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        {status === 'error' && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            aria-label="Retry scan"
            className="flex-shrink-0 text-gray-400 hover:text-gray-700"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        )}
        {canRefetch && (
          <button
            type="button"
            onClick={handleRefetch}
            disabled={refetching}
            aria-label="Refetch from Zoho"
            title="Refetch from Zoho"
            className="flex-shrink-0 text-gray-400 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${refetching ? 'animate-spin' : ''}`} />
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="flex-shrink-0 text-gray-300 hover:text-gray-600"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
