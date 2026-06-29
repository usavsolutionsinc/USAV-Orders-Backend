'use client';

/**
 * Enriched bin table for the inventory hub main area.
 *
 * Columns: ☑ · Barcode · Room · Location · SKUs · Qty · Fill · Last counted · Status
 * Row click → flyout (parent controls).
 * Bulk-select drives the parent's selection set.
 */

import { useMemo, useState } from 'react';
import type { BinsOverviewRow } from '@/hooks/useBinsOverview';
import { FillBar } from './FillBar';
import { StatusChips } from './StatusChip';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

type SortKey = 'barcode' | 'room' | 'sku_count' | 'total_qty' | 'fill' | 'last_counted';
type SortDir = 'asc' | 'desc';

interface Props {
  rows: BinsOverviewRow[];
  loading: boolean;
  /** Selection state (controlled by parent so the bulk action bar can read it). */
  selected: Set<number>;
  onSelectChange: (next: Set<number>) => void;
  onRowClick: (row: BinsOverviewRow) => void;
}

function fmtAge(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const d = Math.floor(ms / 86400000);
  if (d < 1) return 'today';
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(mo / 12)}y`;
}

export function BinsTable({ rows, loading, selected, onSelectChange, onRowClick }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('room');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const sorted = useMemo(() => {
    const cmp = (a: BinsOverviewRow, b: BinsOverviewRow): number => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'barcode':      return dir * String(a.barcode ?? '').localeCompare(String(b.barcode ?? ''));
        case 'room':         return dir * (
          (String(a.room ?? '').localeCompare(String(b.room ?? '')))
          || (String(a.row_label ?? '').localeCompare(String(b.row_label ?? '')))
          || (String(a.col_label ?? '').localeCompare(String(b.col_label ?? '')))
        );
        case 'sku_count':    return dir * (a.sku_count - b.sku_count);
        case 'total_qty':    return dir * (a.total_qty - b.total_qty);
        case 'fill':         return dir * ((a.fill_pct ?? -1) - (b.fill_pct ?? -1));
        case 'last_counted': {
          const av = a.last_counted ? new Date(a.last_counted).getTime() : 0;
          const bv = b.last_counted ? new Date(b.last_counted).getTime() : 0;
          return dir * (av - bv);
        }
      }
    };
    return [...rows].sort(cmp);
  }, [rows, sortKey, sortDir]);

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectChange(next);
  };

  const toggleAll = () => {
    if (selected.size === sorted.length) {
      onSelectChange(new Set());
    } else {
      onSelectChange(new Set(sorted.map((r) => r.id)));
    }
  };

  const setSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-micro font-bold uppercase tracking-wider text-gray-500">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={sorted.length > 0 && selected.size === sorted.length}
                  ref={(el) => {
                    if (el) el.indeterminate = selected.size > 0 && selected.size < sorted.length;
                  }}
                  onChange={toggleAll}
                  aria-label="Select all"
                />
              </th>
              <Th label="Barcode"      active={sortKey === 'barcode'}      dir={sortDir} onClick={() => setSort('barcode')} />
              <Th label="Room / Location" active={sortKey === 'room'}      dir={sortDir} onClick={() => setSort('room')} />
              <Th label="SKUs"         active={sortKey === 'sku_count'}    dir={sortDir} onClick={() => setSort('sku_count')} align="right" />
              <Th label="Qty"          active={sortKey === 'total_qty'}    dir={sortDir} onClick={() => setSort('total_qty')} align="right" />
              <Th label="Fill"         active={sortKey === 'fill'}         dir={sortDir} onClick={() => setSort('fill')} />
              <Th label="Counted"      active={sortKey === 'last_counted'} dir={sortDir} onClick={() => setSort('last_counted')} />
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && sorted.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">Loading bins…</td></tr>
            )}
            {!loading && sorted.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">No bins match the current filters.</td></tr>
            )}
            {sorted.map((row) => {
              const isSelected = selected.has(row.id);
              return (
                <tr
                  key={row.id}
                  className={`cursor-pointer ${isSelected ? 'bg-blue-50/40' : 'hover:bg-gray-50'}`}
                  onClick={() => onRowClick(row)}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(row.id)}
                      aria-label={`Select ${row.barcode ?? row.name}`}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-blue-700">
                    {row.barcode ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div className="font-semibold text-gray-900">
                      {row.room ?? <span className="text-gray-400">—</span>}
                      {row.zone_letter && (
                        <span className="ml-1 font-mono text-micro text-blue-600">[{row.zone_letter}]</span>
                      )}
                    </div>
                    <div className="text-micro text-gray-500">
                      {row.row_label ?? '—'} · {row.col_label ?? '—'}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-gray-700">
                    {row.sku_count}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-gray-700">
                    {row.total_qty}
                  </td>
                  <td className="w-32 px-3 py-2">
                    <FillBar pct={row.fill_pct} current={row.total_qty} max={row.capacity} />
                  </td>
                  <HoverTooltip label={row.last_counted ?? 'never'} asChild>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {fmtAge(row.last_counted)}
                    </td>
                  </HoverTooltip>
                  <td className="px-3 py-2">
                    <StatusChips
                      is_empty={row.is_empty}
                      has_low_stock={row.has_low_stock}
                      is_over_capacity={row.is_over_capacity}
                      is_stale={row.is_stale}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  label, active, dir, onClick, align = 'left',
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: 'left' | 'right';
}) {
  return (
    <th className={`px-3 py-2 ${align === 'right' ? 'text-right' : ''}`}>
      <button
        type="button"
        onClick={onClick}
        className={`ds-raw-button inline-flex items-center gap-1 transition-colors ${
          active ? 'text-gray-900' : 'hover:text-gray-700'
        }`}
      >
        {label}
        {active && (
          <span className="text-mini" aria-hidden>
            {dir === 'asc' ? '▲' : '▼'}
          </span>
        )}
      </button>
    </th>
  );
}
