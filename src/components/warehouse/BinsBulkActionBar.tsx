'use client';

/**
 * Sticky bottom action bar — visible only when one or more bin rows are
 * selected. Print N labels + Export CSV are wired; Mark-for-cycle-count
 * is a stub button until the cycle-count UI lands.
 */

import { useCallback } from 'react';
import { toast } from 'sonner';
import type { BinsOverviewRow } from '@/hooks/useBinsOverview';
import { Printer } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';

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
      className="sticky bottom-0 left-0 right-0 z-sticky border-t border-border-soft bg-surface-card/95 px-4 py-3 backdrop-blur-md"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <div className="text-sm font-semibold text-text-default">
          {count} bin{count === 1 ? '' : 's'} selected
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearSelection}
          className="text-caption text-text-soft hover:text-text-muted"
        >
          Clear
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="md"
            icon={<Printer />}
            onClick={printLabels}
          >
            Print {count} label{count === 1 ? '' : 's'}
          </Button>
          <Button variant="secondary" size="md" onClick={exportCsv}>
            Export CSV
          </Button>
          <HoverTooltip label="Cycle count UI lands in the next update" asChild>
            <Button
              variant="secondary"
              size="md"
              onClick={() => toast('Cycle counts arrive in the next update.')}
              className="text-text-soft"
            >
              Mark for cycle count
            </Button>
          </HoverTooltip>
        </div>
      </div>
    </div>
  );
}
