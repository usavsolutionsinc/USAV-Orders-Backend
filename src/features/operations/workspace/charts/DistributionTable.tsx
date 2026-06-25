'use client';

import type { ReactNode } from 'react';
import { cn } from '@/utils/_cn';
import { tableHeader } from '@/design-system/tokens/typography/presets';
import { DEFAULT_SERIES_TONE, NEUTRAL_TONE } from './chart-theme';

export interface DistributionRow {
  key: string;
  label: string;
  sublabel?: string;
  count: number;
  percent: number;
  color?: string;
  icon?: ReactNode;
}

interface DistributionTableProps {
  columns?: [string, string, string];
  rows: DistributionRow[];
  emptyMessage?: string;
  /** Draw a faint proportional bar behind each row (velocity-tier style). */
  showBar?: boolean;
  className?: string;
}

export function DistributionTable({
  columns = ['Source', 'Count', '%'],
  rows,
  emptyMessage = 'No data in this range.',
  showBar = false,
  className,
}: DistributionTableProps) {
  return (
    <div className={cn('w-full', className)}>
      <div className={cn('flex items-center justify-between pb-2', tableHeader)}>
        <span>{columns[0]}</span>
        <span className="flex items-center gap-4">
          <span className="w-12 text-right">{columns[1]}</span>
          <span className="w-10 text-right">{columns[2]}</span>
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-caption text-gray-400">
          {emptyMessage}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((row) => (
            <li key={row.key} className="relative flex items-center justify-between py-2">
              {showBar && (
                <span
                  className="absolute inset-y-1 left-0 rounded-md"
                  style={{
                    width: `${Math.min(100, Math.max(0, row.percent))}%`,
                    backgroundColor: row.color ?? DEFAULT_SERIES_TONE,
                    opacity: 0.1,
                  }}
                  aria-hidden
                />
              )}
              <span className="relative flex min-w-0 items-center gap-2">
                {row.icon ?? (
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: row.color ?? NEUTRAL_TONE }}
                    aria-hidden
                  />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-caption font-semibold text-gray-900">{row.label}</span>
                  {row.sublabel && (
                    <span className="block truncate text-eyebrow font-semibold uppercase tracking-widest text-gray-400">
                      {row.sublabel}
                    </span>
                  )}
                </span>
              </span>
              <span className="relative flex items-center gap-4">
                <span className="w-12 text-right text-caption font-bold tabular-nums text-gray-900">
                  {row.count.toLocaleString()}
                </span>
                <span className="w-10 text-right text-caption font-semibold tabular-nums text-gray-500">
                  {row.percent.toFixed(1)}%
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
