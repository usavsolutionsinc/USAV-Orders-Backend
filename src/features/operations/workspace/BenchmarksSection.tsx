'use client';

/**
 * "You vs typical" — the Phase 1 benchmark readout (plan §2.5) inside the
 * Operations → Analytics Monitor. Read-only, org-scoped: pairs the org's own
 * actuals (inventory_events) with the seeded reseller-vertical benchmarks
 * (insight_links, global NULL-org rows). Degrade-not-fail: a failed fetch or
 * unseeded table renders the dashed teaching state, never an error page.
 */

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';
import { cn } from '@/utils/_cn';

interface BenchmarkRow {
  linkage_type: string;
  subject_kind: string;
  subject_ref: string | null;
  metrics: Record<string, unknown> | null;
  source: string;
  organization_id: string | null;
}

interface BenchmarksPayload {
  success: boolean;
  actuals: {
    rangeDays: number;
    testFailPct: number | null;
    testEvents: number;
    returnPct: number | null;
    shippedCount: number;
    returnedCount: number;
  };
  benchmarks: BenchmarkRow[];
}

interface ComparisonRow {
  key: string;
  label: string;
  you: number | null;
  youSuffix: string;
  typical: string;
  basis: string;
  /** 'good' | 'high' | 'unknown' vs the seeded range (lower is better here). */
  verdict: 'good' | 'high' | 'unknown';
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function buildRows(data: BenchmarksPayload): ComparisonRow[] {
  const byMetric = new Map<string, BenchmarkRow>();
  for (const b of data.benchmarks) {
    const metric = b.metrics && typeof b.metrics.metric === 'string' ? b.metrics.metric : null;
    // org-specific rows sort first from the API; keep the first per metric
    if (metric && !byMetric.has(metric)) byMetric.set(metric, b);
  }

  const rows: ComparisonRow[] = [];
  const push = (
    key: string,
    label: string,
    you: number | null,
    youSuffix: string,
    rangeKey: 'range_pct' | 'range_days',
    typicalKey: 'typical_pct' | 'typical_days',
  ) => {
    const bench = byMetric.get(key);
    const m = bench?.metrics ?? null;
    const typical = num(m?.[typicalKey]);
    const range = Array.isArray(m?.[rangeKey]) ? (m?.[rangeKey] as unknown[]).map(num) : null;
    const lo = range?.[0] ?? null;
    const hi = range?.[1] ?? null;
    let verdict: ComparisonRow['verdict'] = 'unknown';
    if (you != null && hi != null) verdict = you > hi ? 'high' : 'good';
    rows.push({
      key,
      label,
      you,
      youSuffix,
      typical:
        typical != null
          ? `${typical}${youSuffix}${lo != null && hi != null ? ` (${lo}–${hi}${youSuffix})` : ''}`
          : '—',
      basis: typeof m?.basis === 'string' ? m.basis : 'Seeded vertical benchmark.',
      verdict,
    });
  };

  push('test_fail_pct', 'Test-fail rate', data.actuals.testFailPct, '%', 'range_pct', 'typical_pct');
  push('return_pct', 'Return rate', data.actuals.returnPct, '%', 'range_pct', 'typical_pct');
  push('receive_to_list_days', 'Receive → list', null, 'd', 'range_days', 'typical_days');
  return rows;
}

const VERDICT_CHIP: Record<ComparisonRow['verdict'], { label: string; cls: string }> = {
  good: { label: 'In range', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  high: { label: 'Above typical', cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
  unknown: { label: 'No data', cls: 'bg-surface-canvas text-text-soft ring-border-soft' },
};

export function BenchmarksSection({ rangeDays }: { rangeDays: number }) {
  const query = useQuery({
    queryKey: ['operations-benchmarks', rangeDays],
    queryFn: async (): Promise<BenchmarksPayload> => {
      const res = await fetch(`/api/operations/benchmarks?rangeDays=${rangeDays}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('benchmarks fetch failed');
      return res.json();
    },
    staleTime: 60_000,
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-caption font-semibold text-text-soft">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (query.isError || !query.data?.success) {
    return (
      <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center">
        <p className="text-caption font-bold text-rose-700">Could not load benchmarks.</p>
        <div className="mt-2">
          <Button variant="ghost" size="sm" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const rows = buildRows(query.data);
  const seeded = query.data.benchmarks.length > 0;

  if (!seeded) {
    return (
      <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-6 text-center">
        <p className="text-caption font-bold text-text-muted">No benchmarks seeded yet</p>
        <p className="mt-1 text-micro leading-5 text-text-soft">
          Apply the insight_links seed migration to compare your numbers against the vertical.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="divide-y divide-border-hairline">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <HoverTooltip label={row.basis}>
                <p className="truncate text-caption font-bold text-text-default">{row.label}</p>
              </HoverTooltip>
              <p className="truncate text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
                Typical {row.typical}
              </p>
            </div>
            <p className="text-label font-black tabular-nums text-text-default">
              {row.you != null ? `${row.you}${row.youSuffix}` : '—'}
            </p>
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-mini font-black uppercase tracking-widest ring-1 ring-inset',
                VERDICT_CHIP[row.verdict].cls,
              )}
            >
              {VERDICT_CHIP[row.verdict].label}
            </span>
          </div>
        ))}
      </div>
      <p className="text-micro leading-5 text-text-soft">
        Your last {query.data.actuals.rangeDays}d vs seeded used-electronics-reseller benchmarks (editable seeds — ask
        the assistant &ldquo;how do we compare to typical&rdquo; for the full picture).
      </p>
    </div>
  );
}
