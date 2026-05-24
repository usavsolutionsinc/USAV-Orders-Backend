'use client';

import { ScanStatusChip } from '@/components/sidebar/ScanStatusChip';
import type { PendingScan } from './receiving-sidebar-shared';

interface Props {
  pendingScans: PendingScan[];
  onClear: () => void;
  onRetry: (scan: PendingScan) => void;
  onRefetch: (scan: PendingScan) => void;
  onDismiss: (scanId: string) => void;
}

/**
 * Footer chip stack rendering each in-flight / terminal tracking scan. Hidden
 * when there are no pending scans. Retry/refetch buttons surface for the
 * relevant statuses only — the parent wires the action handlers.
 */
export function ReceivingScanStatusList({
  pendingScans,
  onClear,
  onRetry,
  onRefetch,
  onDismiss,
}: Props) {
  if (pendingScans.length === 0) return null;

  return (
    <div className="border-t border-gray-200">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <p className="text-eyebrow font-black uppercase tracking-widest text-gray-500">
          Scans · {pendingScans.length}
        </p>
        <button
          type="button"
          onClick={onClear}
          className="text-eyebrow font-black uppercase tracking-wider text-gray-400 hover:text-gray-700"
        >
          Clear
        </button>
      </div>
      <div className="flex flex-col">
        {pendingScans.map((scan) => (
          <ScanStatusChip
            key={scan.id}
            tracking={scan.tracking}
            status={scan.status}
            errorMessage={scan.errorMessage}
            exceptionId={scan.exception_id ?? null}
            exceptionReason={scan.exception_reason ?? null}
            onRetry={scan.status === 'error' ? () => onRetry(scan) : undefined}
            onRefetch={
              scan.status === 'unmatched' || scan.status === 'matched'
                ? () => onRefetch(scan)
                : undefined
            }
            onDismiss={() => onDismiss(scan.id)}
          />
        ))}
      </div>
    </div>
  );
}
