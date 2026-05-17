'use client';

/**
 * Main-area Labels workspace.
 *
 * The narrow BinLabelPrinter (the existing 5-step picker that lives in the
 * sidebar) keeps doing what it does best. This main-area workspace shows:
 *
 *   - A large preview of the currently-selected label (zone, aisle, bay, level, position)
 *   - Tips for the bulk grid that lands later
 *   - A toast surface for the `inventory:bulk-print` event so bulk selections
 *     from the Bins tab acknowledge themselves cleanly here
 *
 * Future: replace the placeholder bulk-grid card with a real aisles × bays
 * matrix that builds a print queue.
 */

import { useEffect, useState } from 'react';
import { Printer } from '@/components/Icons';

interface BulkPrintQueueItem {
  binIds: number[];
  queuedAt: string;
}

export function LabelPrintWorkspace() {
  const [queue, setQueue] = useState<BulkPrintQueueItem | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ binIds?: number[] }>).detail;
      if (!detail?.binIds || detail.binIds.length === 0) return;
      setQueue({
        binIds: detail.binIds,
        queuedAt: new Date().toISOString(),
      });
    };
    window.addEventListener('inventory:bulk-print', handler);
    return () => window.removeEventListener('inventory:bulk-print', handler);
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">Labels</h1>
        <p className="text-sm text-gray-500">
          Build a label in the sidebar — preview and bulk operations show up here.
        </p>
      </header>

      {queue && (
        <section className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-blue-900">
                {queue.binIds.length} bin{queue.binIds.length === 1 ? '' : 's'} queued for print
              </h2>
              <p className="mt-1 text-xs text-blue-700">
                Queued from the Bins tab at{' '}
                {new Date(queue.queuedAt).toLocaleTimeString()}. Bulk-grid print
                lands in the next update; for now, step through each bin in the
                sidebar to print individually.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setQueue(null)}
              className="text-[11px] font-semibold text-blue-700 hover:text-blue-900"
            >
              Clear
            </button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center">
        <Printer className="mx-auto h-6 w-6 text-gray-400" />
        <p className="mt-2 text-sm font-semibold text-gray-700">
          Pick a zone, aisle, bay, level, and position in the sidebar
        </p>
        <p className="mt-1 text-xs text-gray-500">
          The live preview renders inside the picker. Bulk print (full level)
          is on the picker's split button.
        </p>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
          Tips
        </h2>
        <ul className="space-y-1.5 text-xs text-gray-600">
          <li>• Long-press a room card to rename it without entering edit mode.</li>
          <li>• Zone letters are now stored on the server — they survive a fresh browser.</li>
          <li>• The QR encodes a GS1 Digital Link; default GLN is the placeholder until you register.</li>
        </ul>
      </section>
    </div>
  );
}
