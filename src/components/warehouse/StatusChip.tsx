'use client';

import type { ReactNode } from 'react';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

export type BinStatus = 'empty' | 'low' | 'over' | 'stale' | 'ok';

interface Props {
  status: BinStatus;
  /** Show full label (default) or just the dot. */
  compact?: boolean;
}

const TONE: Record<BinStatus, { bg: string; text: string; ring: string; dot: string; label: string }> = {
  empty: {
    bg: 'bg-slate-50', text: 'text-slate-600', ring: 'ring-slate-200',
    dot: 'bg-slate-400', label: 'Empty',
  },
  low: {
    bg: 'bg-amber-50', text: 'text-amber-800', ring: 'ring-amber-200',
    dot: 'bg-amber-500', label: 'Low',
  },
  over: {
    bg: 'bg-red-50', text: 'text-red-700', ring: 'ring-red-200',
    dot: 'bg-red-500', label: 'Over cap',
  },
  stale: {
    bg: 'bg-purple-50', text: 'text-purple-700', ring: 'ring-purple-200',
    dot: 'bg-purple-500', label: 'Stale',
  },
  ok: {
    bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200',
    dot: 'bg-emerald-500', label: 'OK',
  },
};

export function StatusChip({ status, compact }: Props) {
  const tone = TONE[status];
  if (compact) {
    return (
      <HoverTooltip label={tone.label} asChild>
        <span
          className={`inline-block h-2 w-2 rounded-full ${tone.dot}`}
          aria-label={tone.label}
        />
      </HoverTooltip>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-eyebrow font-semibold uppercase tracking-wider ring-1 ${tone.bg} ${tone.text} ${tone.ring}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {tone.label}
    </span>
  );
}

/** Render every applicable status chip given the booleans. */
export function StatusChips({
  is_empty,
  has_low_stock,
  is_over_capacity,
  is_stale,
  compact,
}: {
  is_empty: boolean;
  has_low_stock: boolean;
  is_over_capacity: boolean;
  is_stale: boolean;
  compact?: boolean;
}): ReactNode {
  const chips: BinStatus[] = [];
  if (is_empty) chips.push('empty');
  if (has_low_stock) chips.push('low');
  if (is_over_capacity) chips.push('over');
  if (is_stale) chips.push('stale');
  if (chips.length === 0) chips.push('ok');
  return (
    <span className="inline-flex flex-wrap gap-1">
      {chips.map((c) => (
        <StatusChip key={c} status={c} compact={compact} />
      ))}
    </span>
  );
}
