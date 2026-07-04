'use client';

import { useMemo } from 'react';
import { cn } from '@/utils/_cn';
import { useMeasuredWidth } from './use-measured-width';
import { DEFAULT_SERIES_TONE } from './chart-theme';

export interface HeatCell {
  row: number;
  col: number;
  value: number;
}

interface ActivityHeatmapProps {
  rows: number;
  cols: number;
  cells: HeatCell[];
  rowLabels?: string[];
  colLabels?: string[];
  /** Hotspot hue; empty cells stay a faint neutral dot. */
  color?: string;
  className?: string;
}

const TOP_PAD = 18;
const LEFT_PAD = 38;
const ROW_H = 20;

/**
 * Dotted activity grid — the operations-floor analogue of the Figma demographics
 * map. Each dot's hue intensity tracks event volume; empty slots stay a faint
 * neutral dot (currentColor, so it dims correctly in dark mode).
 */
export function ActivityHeatmap({
  rows,
  cols,
  cells,
  rowLabels,
  colLabels,
  color = DEFAULT_SERIES_TONE,
  className,
}: ActivityHeatmapProps) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>(560);

  const { lookup, max } = useMemo(() => {
    const map = new Map<string, number>();
    let peak = 0;
    for (const c of cells) {
      map.set(`${c.row}:${c.col}`, c.value);
      if (c.value > peak) peak = c.value;
    }
    return { lookup: map, max: peak };
  }, [cells]);

  const cellW = cols > 0 ? (width - LEFT_PAD) / cols : 0;
  const height = TOP_PAD + rows * ROW_H + 8;

  return (
    <div ref={ref} className={cn('w-full', className)}>
      <svg width={width} height={height} role="img" aria-label="Activity heatmap">
        {/* column labels */}
        {colLabels && (
          <g className="text-text-faint">
            {colLabels.map((label, c) =>
              c % Math.max(1, Math.ceil(cols / 12)) === 0 ? (
                <text
                  key={c}
                  x={LEFT_PAD + c * cellW + cellW / 2}
                  y={12}
                  textAnchor="middle"
                  fill="currentColor"
                  className="text-mini font-semibold"
                >
                  {label}
                </text>
              ) : null,
            )}
          </g>
        )}

        {/* row labels */}
        {rowLabels && (
          <g className="text-text-faint">
            {rowLabels.map((label, r) => (
              <text
                key={r}
                x={LEFT_PAD - 8}
                y={TOP_PAD + r * ROW_H + ROW_H / 2 + 3}
                textAnchor="end"
                fill="currentColor"
                className="text-mini font-semibold uppercase tracking-wider"
              >
                {label}
              </text>
            ))}
          </g>
        )}

        {/* dots */}
        {Array.from({ length: rows }).map((_, r) =>
          Array.from({ length: cols }).map((__, c) => {
            const value = lookup.get(`${r}:${c}`) ?? 0;
            const intensity = max > 0 && value > 0 ? Math.max(0.22, value / max) : 0;
            const cx = LEFT_PAD + c * cellW + cellW / 2;
            const cy = TOP_PAD + r * ROW_H + ROW_H / 2;
            if (intensity === 0) {
              return (
                <g key={`${r}:${c}`} className="text-gray-200">
                  <circle cx={cx} cy={cy} r={2.5} fill="currentColor" />
                </g>
              );
            }
            return (
              <circle
                key={`${r}:${c}`}
                cx={cx}
                cy={cy}
                r={2.5 + intensity * 3}
                fill={color}
                fillOpacity={intensity}
              >
                <title>{value.toLocaleString()} events</title>
              </circle>
            );
          }),
        )}
      </svg>
    </div>
  );
}
