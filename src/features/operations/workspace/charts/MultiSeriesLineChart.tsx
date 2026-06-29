'use client';

import { useId, useMemo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/utils/_cn';
import { useMeasuredWidth } from './use-measured-width';

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  points: number[];
}

interface MultiSeriesLineChartProps {
  series: LineSeries[];
  xLabels: string[];
  height?: number;
  yTicks?: number;
  /** Fill a soft gradient under each line (Figma hero style). */
  area?: boolean;
  className?: string;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PAD = { top: 14, right: 14, bottom: 24, left: 40 };

function niceMax(value: number): number {
  if (value <= 0) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 1.5, 2, 2.5, 5, 10]) {
    if (step * pow >= value) return step * pow;
  }
  return 10 * pow;
}

export function MultiSeriesLineChart({
  series,
  xLabels,
  height = 260,
  yTicks = 4,
  area = true,
  className,
}: MultiSeriesLineChartProps) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>(760);
  const gradientId = useId();

  const model = useMemo(() => {
    const count = Math.max(...series.map((s) => s.points.length), 0);
    const peak = Math.max(0, ...series.flatMap((s) => s.points));
    const top = niceMax(peak);
    const innerW = Math.max(0, width - PAD.left - PAD.right);
    const innerH = Math.max(0, height - PAD.top - PAD.bottom);
    const xFor = (i: number) => (count <= 1 ? PAD.left + innerW / 2 : PAD.left + (i / (count - 1)) * innerW);
    const yFor = (v: number) => PAD.top + innerH * (1 - (top === 0 ? 0 : v / top));
    const baseline = yFor(0);
    const safeTicks = yTicks > 0 ? yTicks : 4;
    const ticks = Array.from({ length: safeTicks + 1 }, (_, i) => (top / safeTicks) * i);
    return { count, top, innerW, innerH, xFor, yFor, baseline, ticks };
  }, [series, width, height, yTicks]);

  const hasData = model.count > 0 && model.top > 0;
  // Render at most ~8 x-axis labels to avoid crowding.
  const labelStride = Math.max(1, Math.ceil(xLabels.length / 8));

  return (
    <div ref={ref} className={cn('w-full', className)}>
      <svg width={width} height={height} role="img" aria-label="Throughput over time" className="overflow-visible">
        {/* horizontal grid — inherits dark-mode via currentColor */}
        <g className="text-gray-200">
          {model.ticks.map((t, i) => {
            const y = model.yFor(t);
            return (
              <line key={i} x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} stroke="currentColor" strokeWidth={1} />
            );
          })}
        </g>

        {/* y-axis tick labels */}
        <g className="text-gray-400">
          {model.ticks.map((t, i) => (
            <text
              key={i}
              x={PAD.left - 8}
              y={model.yFor(t) + 3}
              textAnchor="end"
              fill="currentColor"
              className="text-eyebrow font-semibold tabular-nums"
            >
              {Math.round(t).toLocaleString()}
            </text>
          ))}
        </g>

        {/* x-axis labels */}
        <g className="text-gray-400">
          {xLabels.map((label, i) =>
            i % labelStride === 0 ? (
              <text
                key={i}
                x={model.xFor(i)}
                y={height - 7}
                textAnchor="middle"
                fill="currentColor"
                className="text-eyebrow font-semibold"
              >
                {label}
              </text>
            ) : null,
          )}
        </g>

        {hasData &&
          series.map((s, si) => {
            const pts = s.points.map((v, i) => `${model.xFor(i)},${model.yFor(v)}`);
            const linePoints = pts.join(' ');
            const areaPath =
              pts.length > 0
                ? `M ${model.xFor(0)},${model.baseline} L ${pts.join(' L ')} L ${model.xFor(pts.length - 1)},${model.baseline} Z`
                : '';
            const gid = `${gradientId}-${si}`;
            return (
              <g key={s.key}>
                {area && (
                  <>
                    <defs>
                      <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                        <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <motion.path
                      d={areaPath}
                      fill={`url(#${gid})`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.5, delay: 0.1 + si * 0.06, ease: EASE }}
                    />
                  </>
                )}
                <motion.polyline
                  points={linePoints}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.9, delay: si * 0.08, ease: EASE }}
                />
              </g>
            );
          })}

        {!hasData && (
          <g className="text-gray-400">
            <text x={width / 2} y={height / 2} textAnchor="middle" fill="currentColor" className="text-caption font-semibold">
              No activity in this range
            </text>
          </g>
        )}
      </svg>

      {/* legend */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
            <span className="text-eyebrow font-bold uppercase tracking-widest text-gray-500">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
