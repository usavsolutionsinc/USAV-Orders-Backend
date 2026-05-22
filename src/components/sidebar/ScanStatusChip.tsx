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
  checking: 'Checking',
  matched: 'PO Loaded',
  unmatched: 'No PO',
  error: 'Retry',
};

// Filled pill tones in the same family as WORKFLOW_BADGE / condition pills so
// scan status reads as part of the same visual language.
const PILL_TONE: Record<ScanStatus, string> = {
  checking: 'bg-blue-100 text-blue-700 animate-pulse',
  matched: 'bg-emerald-100 text-emerald-700',
  unmatched: 'bg-amber-100 text-amber-700',
  error: 'bg-red-100 text-red-700',
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
  const label = LABELS[status];

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
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${PILL_TONE[status]}`}
          title={status === 'unmatched' ? 'Tracking logged — no matching Zoho PO yet' : undefined}
        >
          {label}
        </span>
        <TrackingChip value={tracking} display={getLast4(tracking)} />
        {status === 'error' && errorMessage ? (
          <span
            className="truncate text-[9px] font-semibold text-red-600"
            title={errorMessage}
          >
            {errorMessage}
          </span>
        ) : null}
        {status === 'unmatched' && exceptionId ? (
          <a
            href={`/tracking-exceptions?q=${encodeURIComponent(tracking)}`}
            target="_blank"
            rel="noreferrer"
            title={exceptionReason ? `Queued #${exceptionId} · ${exceptionReason}` : `Queued #${exceptionId}`}
            className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200 hover:text-gray-900"
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
