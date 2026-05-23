'use client';

/**
 * Main-area Labels workspace.
 *
 * Hosts the full location label printer (formerly in the sidebar). The printer
 * now lives here so the 5-step picker + live preview can breathe in the
 * full content column instead of being cramped against the rail.
 *
 * Sidebar shows a short contextual hint; bulk-print events from the Bins
 * tab surface as a toast at the top of this workspace.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BinLabelPrinter } from '@/components/barcode/BinLabelPrinter';

export function LabelPrintWorkspace() {
  const [queuedBins, setQueuedBins] = useState<number[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ binIds?: number[] }>).detail;
      if (!detail?.binIds || detail.binIds.length === 0) return;
      setQueuedBins(detail.binIds);
      toast.info(
        `${detail.binIds.length} bin${detail.binIds.length === 1 ? '' : 's'} queued for print — step through each one to print individually.`,
      );
    };
    window.addEventListener('inventory:bulk-print', handler);
    return () => window.removeEventListener('inventory:bulk-print', handler);
  }, []);

  return (
    // Flex column that fills the /warehouse page's inner flex-col so the
    // BinLabelPrinter's sticky action bar can mt-auto to the bottom edge
    // of the scroll container (matches the receiving LineEditPanel pattern).
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {queuedBins.length > 0 && (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50/50 p-4">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-blue-900">
              {queuedBins.length} bin{queuedBins.length === 1 ? '' : 's'} queued from Bins
            </p>
            <p className="mt-0.5 text-[11.5px] text-blue-700">
              Bulk-grid print lands in the next update. For now, step through each bin below to print it.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setQueuedBins([])}
            className="shrink-0 text-[11px] font-semibold text-blue-700 hover:text-blue-900"
          >
            Clear
          </button>
        </div>
      )}

      <BinLabelPrinter />
    </div>
  );
}
