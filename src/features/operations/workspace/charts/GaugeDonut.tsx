'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/utils/_cn';

export interface GaugeSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

interface GaugeDonutProps {
  segments: GaugeSegment[];
  /** Defaults to the sum of segment values. */
  total?: number;
  centerLabel?: string;
  size?: number;
  thickness?: number;
  className?: string;
}

const EASE = [0.22, 1, 0.36, 1] as const;

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
}

export function GaugeDonut({
  segments,
  total,
  centerLabel = 'Events',
  size = 200,
  thickness = 16,
  className,
}: GaugeDonutProps) {
  const sum = total ?? segments.reduce((acc, s) => acc + Math.max(0, s.value), 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - thickness / 2 - 4;
  const height = size / 2 + 14;

  const arcs = useMemo(() => {
    if (sum <= 0) return [] as { key: string; color: string; d: string }[];
    const gap = segments.length > 1 ? 3 : 0;
    let acc = 0;
    return segments
      .filter((s) => s.value > 0)
      .map((s) => {
        const startFrac = acc / sum;
        acc += s.value;
        const endFrac = acc / sum;
        const a0 = 180 + startFrac * 180;
        const a1 = 180 + endFrac * 180 - gap;
        return { key: s.key, color: s.color, d: arcPath(cx, cy, r, a0, Math.max(a0, a1)) };
      });
  }, [segments, sum, cx, cy, r]);

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <svg width={size} height={height} role="img" aria-label={`${centerLabel} gauge`}>
        {/* track */}
        <g className="text-surface-strong">
          <path
            d={arcPath(cx, cy, r, 180, 360)}
            fill="none"
            stroke="currentColor"
            strokeWidth={thickness}
            strokeLinecap="round"
          />
        </g>
        {arcs.map((arc, i) => (
          <motion.path
            key={arc.key}
            d={arc.d}
            fill="none"
            stroke={arc.color}
            strokeWidth={thickness}
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.1 + i * 0.08, ease: EASE }}
          />
        ))}
        {/* center readout — currentColor so it inherits the dark-mode remap */}
        <g className="text-text-default">
          <text x={cx} y={cy - r * 0.18} textAnchor="middle" fill="currentColor" className="text-2xl font-black tabular-nums">
            {sum.toLocaleString()}
          </text>
        </g>
        <g className="text-text-faint">
          <text x={cx} y={cy + 4} textAnchor="middle" fill="currentColor" className="text-micro font-bold uppercase tracking-[0.18em]">
            {centerLabel}
          </text>
        </g>
      </svg>
    </div>
  );
}
