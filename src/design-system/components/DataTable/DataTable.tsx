'use client';

import { type ReactNode } from 'react';
import { cn } from '@/utils/_cn';
import { tableHeader, tableCell } from '../../tokens/typography/presets';
import { EmptyState } from '../../primitives/EmptyState';

// ─── DataTable ───────────────────────────────────────────────────────────────
//
// The canonical data-table family. The app ships ~6 bespoke sticky-header
// tables with no shared markup; this is the one reusable surface they collapse
// onto (the adoption plan's `04 · DataTable family`).
//
// Token-first: surface, border, and text come from the semantic tokens and the
// shared typography presets (`tableHeader`, `tableCell`) so every table reads
// identically and themes for free. Column alignment + width are declared once
// in the `columns` schema and applied to both header and cells.
//
// Generic over the row type; the caller maps each column's `cell(row)`.

export type ColumnAlign = 'left' | 'center' | 'right';

export interface DataTableColumn<Row> {
  /** Stable key (also the React key for the header/cell). */
  key: string;
  /** Header label. */
  header: ReactNode;
  /** Cell renderer for a row. */
  cell: (row: Row) => ReactNode;
  /** Text alignment for header + cells. Default `left`. */
  align?: ColumnAlign;
  /** Optional fixed/min width (CSS value, e.g. '140px'). */
  width?: string;
}

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  /** Stable row key. */
  rowKey: (row: Row, index: number) => string | number;
  /** Optional per-row click. Rows become buttons-in-spirit (hover + cursor). */
  onRowClick?: (row: Row) => void;
  /** Mark a row as the selected/active row. */
  isRowSelected?: (row: Row) => boolean;
  /** Sticky header (default true). */
  stickyHeader?: boolean;
  /** Shown when `rows` is empty. */
  empty?: ReactNode;
  className?: string;
}

const ALIGN: Record<ColumnAlign, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  onRowClick,
  isRowSelected,
  stickyHeader = true,
  empty,
  className,
}: DataTableProps<Row>) {
  if (rows.length === 0) {
    return (
      <div className={cn('rounded-xl border border-border-soft bg-surface-card', className)}>
        {empty ?? <EmptyState title="Nothing here yet" description="No rows to display." />}
      </div>
    );
  }

  return (
    <div className={cn('overflow-hidden rounded-xl border border-border-soft bg-surface-card', className)}>
      <table className="w-full border-collapse">
        <thead className={cn(stickyHeader && 'sticky top-0 z-[1]')}>
          <tr className="bg-surface-canvas">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                style={col.width ? { width: col.width } : undefined}
                className={cn(
                  tableHeader,
                  'whitespace-nowrap border-b border-border-soft px-3 py-2.5',
                  ALIGN[col.align ?? 'left'],
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const selected = isRowSelected?.(row) ?? false;
            const clickable = !!onRowClick;
            return (
              <tr
                key={rowKey(row, index)}
                onClick={clickable ? () => onRowClick(row) : undefined}
                onKeyDown={
                  clickable
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                aria-selected={isRowSelected ? selected : undefined}
                className={cn(
                  'border-b border-border-soft last:border-b-0 transition-colors',
                  clickable &&
                    'cursor-pointer hover:bg-surface-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40',
                  selected && 'bg-surface-canvas',
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(tableCell, 'px-3 py-2.5 align-middle', ALIGN[col.align ?? 'left'])}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
