'use client';

import { HoverTooltip } from '@/components/ui/HoverTooltip';

interface Props {
  /** 0..1 typically; >1 renders as over-capacity. Null = unknown. */
  pct: number | null;
  /** Numerator for the tooltip / label. */
  current?: number;
  /** Denominator for the tooltip / label. */
  max?: number | null;
  className?: string;
}

/**
 * One-line horizontal fill bar. Color tracks the band:
 *   <  5% → slate (empty)
 *   <=95% → emerald
 *   <=100% → amber
 *   > 100% → red (over)
 */
export function FillBar({ pct, current, max, className }: Props) {
  if (pct == null) {
    return (
      <div className={`flex items-center gap-1 ${className ?? ''}`}>
        <div className="h-1.5 flex-1 rounded-full bg-surface-sunken" />
        <span className="text-micro tabular-nums text-text-faint">—</span>
      </div>
    );
  }

  const clamped = Math.max(0, Math.min(pct, 1.5));
  const widthPct = Math.min(clamped, 1) * 100;
  const tone =
    pct === 0     ? 'bg-surface-strong' :
    pct <= 0.95   ? 'bg-emerald-500' :
    pct <= 1.0    ? 'bg-amber-500' :
                    'bg-red-500';

  const labelText = max != null
    ? `${current ?? 0} / ${max}`
    : `${Math.round(pct * 100)}%`;

  return (
    <HoverTooltip
      label={`${Math.round(pct * 100)}%${max != null ? ` (${current ?? 0} / ${max})` : ''}`}
      asChild
    >
      <div className={`flex items-center gap-1.5 ${className ?? ''}`}>
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
          <div
            className={`absolute inset-y-0 left-0 ${tone} transition-[width] duration-300`}
            style={{ width: `${widthPct}%` }}
          />
          {pct > 1 && (
            <div
              className="absolute inset-y-0 right-0 bg-red-500/60"
              style={{ width: `${Math.min((pct - 1), 0.5) * 100}%` }}
            />
          )}
        </div>
        <span className="w-12 shrink-0 text-right text-micro tabular-nums text-text-soft">
          {labelText}
        </span>
      </div>
    </HoverTooltip>
  );
}
