'use client';

/**
 * Triage health strip (Phase 4, docs/receiving-triage-redesign-plan.md §6) —
 * read-only share of cartons saved for unbox while still unpaired (B5).
 * Monitor-archetype content (observe-only, no selection, no edit) living
 * inside a Workbench sidebar — a thin eyebrow+chip strip, not a dashboard.
 */

import { useQuery } from '@tanstack/react-query';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

interface TriageMetrics {
  save_without_pair_rate: number | null;
}

function formatRate(r: number | null): string {
  if (r == null) return '—';
  return `${Math.round(r * 100)}%`;
}

export function TriageMetricsStrip() {
  const { data } = useQuery<TriageMetrics>({
    queryKey: ['receiving', 'triage', 'metrics'] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch('/api/receiving/triage/metrics', { cache: 'no-store' });
      if (!res.ok) return { save_without_pair_rate: null };
      return (await res.json()) as TriageMetrics;
    },
  });

  if (!data || data.save_without_pair_rate == null) return null;

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border-hairline bg-surface-card px-3 py-1.5">
      <HoverTooltip label="Share of cartons saved for unbox while still unpaired (B5)">
        <span className="inline-flex items-center gap-1 rounded bg-surface-sunken px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-text-muted ring-1 ring-inset ring-border-soft">
          Saved unpaired {formatRate(data.save_without_pair_rate)}
        </span>
      </HoverTooltip>
    </div>
  );
}
