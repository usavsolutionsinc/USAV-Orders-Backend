'use client';

/**
 * Sticky bottom action bar — visible only when one or more bin rows are
 * selected. Print N labels + Export CSV are wired; Mark-for-cycle-count
 * is a stub button until the cycle-count UI lands.
 */

import { useCallback } from 'react';
import { toast } from 'sonner';
import type { BinsOverviewRow } from '@/hooks/useBinsOverview';
import { Printer, X } from '@/components/Icons';

interface Props {
  selected: Set<number>;
  rows: BinsOverviewRow[];
  onClearSelection: () => void;
}

export function BinsBulkActionBar({ selected, rows, onClearSelection }: Props) {
  const count = selected.size;
  const selectedRows = rows.filter((r) => selected.has(r.id));

  const exportCsv = useCallback(() => {
    if (selectedRows.length === 0) return;
    const header = [
      'barcode', 'room', 'zone_letter', 'row_label', 'col_label',
      'total_qty', 'sku_count', 'capacity', 'fill_pct',
      'last_counted', 'is_empty', 'has_low_stock', 'is_over_capacity', 'is_stale',
    ];
    const csvRows = selectedRows.map((r) => [
      r.barcode ?? '', r.room ?? '', r.zone_letter ?? '',
      r.row_label ?? '', r.col_label ?? '',
      r.total_qty, r.sku_count, r.capacity ?? '',
      r.fill_pct != null ? (r.fill_pct * 100).toFixed(1) : '',
      r.last_counted ?? '',
      r.is_empty, r.has_low_stock, r.is_over_capacity, r.is_stale,
    ]);
    const csv = [header, ...csvRows]
      .map((line) =>
        line.map((cell) => {
          const s = String(cell);
          // Quote anything with comma, quote, or newline.
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(','),
      )
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bins-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${selectedRows.length} bin${selectedRows.length === 1 ? '' : 's'}`);
  }, [selectedRows]);

  const printLabels = useCallback(() => {
    if (selectedRows.length === 0) return;
    // Dispatch a window event the LabelPrintWorkspace listens for.
    // Decoupled so the bulk bar doesn't depend on the workspace mount state.
    window.dispatchEvent(
      new CustomEvent('inventory:bulk-print', {
        detail: { binIds: Array.from(selected) },
      }),
    );
    toast.success(`Queued ${selectedRows.length} label${selectedRows.length === 1 ? '' : 's'} — open the Labels tab to print.`);
  }, [selected, selectedRows]);

  if (count === 0) return null;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="sticky bottom-0 left-0 right-0 z-30 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur-md"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <div className="text-sm font-semibold text-gray-900">
          {count} bin{count === 1 ? '' : 's'} selected
        </div>
        <button
          type="button"
          onClick={onClearSelection}
          className="text-[11px] font-semibold text-gray-500 hover:text-gray-700"
        >
          Clear
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={printLabels}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 px-4 py-1.5 text-sm font-semibold text-white shadow-md shadow-blue-600/30 transition-transform active:scale-[0.97]"
          >
            <Printer className="h-4 w-4" />
            Print {count} label{count === 1 ? '' : 's'}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => toast('Cycle counts arrive in the next update.')}
            className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-500 hover:bg-gray-50"
            title="Cycle count UI lands in the next update"
          >
            Mark for cycle count
          </button>
        </div>
      </div>
    </div>
  );
}
