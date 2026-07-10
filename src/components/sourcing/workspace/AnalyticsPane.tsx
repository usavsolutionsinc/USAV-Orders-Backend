'use client';

/**
 * Sourcing → Analytics mode (Monitor archetype: observe-only, filters in the
 * URL, no durable selection). Acquisition cost vs the catalog target, demand
 * fill-rate, and time-to-source over part_acquisitions + sku_catalog cost
 * fields, via GET /api/sourcing/analytics?range=.
 *
 * Reuses the Operations chart primitives (MultiSeriesLineChart / GaugeDonut /
 * DistributionTable) — never a second chart implementation.
 */

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { Button } from '@/design-system/primitives/Button';
import { BarChart3 } from '@/components/Icons';
import { MultiSeriesLineChart, type LineSeries } from '@/features/operations/workspace/charts/MultiSeriesLineChart';
import { GaugeDonut } from '@/features/operations/workspace/charts/GaugeDonut';
import { DistributionTable, type DistributionRow } from '@/features/operations/workspace/charts/DistributionTable';
import { paletteTone } from '@/features/operations/workspace/charts/chart-theme';
import {
  jsonFetch,
  formatCents,
  parseSourcingAnalyticsRange,
  SOURCING_ANALYTICS_RANGES,
} from '../sourcing-shared';
import type { SourcingAnalyticsData } from './sourcing-workspace-types';
import { Centered, Empty } from './WorkspaceShared';

function formatDays(days: number | null): string {
  if (days == null) return '—';
  return `${days.toFixed(days >= 10 ? 0 : 1)}d`;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border-soft bg-surface-card p-3">
      <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">{label}</p>
      <p className="mt-1 text-lg font-bold text-text-default">{value}</p>
      {sub ? <p className="text-caption text-text-faint">{sub}</p> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border-soft bg-surface-card p-4">
      <p className="mb-3 text-eyebrow font-black uppercase tracking-widest text-text-soft">{title}</p>
      {children}
    </section>
  );
}

export function AnalyticsPane() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const range = parseSourcingAnalyticsRange(searchParams.get('range'));

  const setRange = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('mode', 'analytics');
      params.set('range', next);
      router.replace(`/sourcing?${params.toString()}`);
    },
    [router, searchParams],
  );

  const { data, isLoading, isError } = useQuery<{ analytics: SourcingAnalyticsData }>({
    queryKey: qk.sourcing.analytics(range),
    queryFn: () => jsonFetch(`/api/sourcing/analytics?range=${range}`),
    staleTime: 30_000,
  });
  const a = data?.analytics;

  const spendSeries = useMemo<LineSeries[]>(() => {
    const buckets = a?.spendByWeek ?? [];
    return [
      {
        key: 'spend',
        label: 'Spend ($)',
        color: paletteTone(0),
        points: buckets.map((b) => Math.round(b.spend_cents / 100)),
      },
      {
        key: 'acquisitions',
        label: 'Acquisitions',
        color: paletteTone(1),
        points: buckets.map((b) => b.acquisitions),
      },
    ];
  }, [a]);
  const spendLabels = useMemo(
    () =>
      (a?.spendByWeek ?? []).map((b) => {
        const d = new Date(b.bucket);
        return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`;
      }),
    [a],
  );

  const costRows = useMemo<DistributionRow[]>(() => {
    const rows = a?.skuCosts ?? [];
    const maxSpend = Math.max(1, ...rows.map((r) => r.spend_cents));
    return rows.map((r, i) => {
      const target = r.replenish_target_cents ?? r.last_known_cost_cents;
      const delta =
        target != null && r.avg_cost_cents != null ? target - r.avg_cost_cents : null;
      return {
        key: String(r.sku_id),
        label: r.product_title ?? r.sku ?? `SKU #${r.sku_id}`,
        sublabel: [
          r.avg_cost_cents != null ? `avg ${formatCents(r.avg_cost_cents)}` : null,
          target != null ? `target ${formatCents(target)}` : null,
          delta != null ? `${delta >= 0 ? 'saves' : 'over by'} ${formatCents(Math.abs(delta))}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        count: r.acquisitions,
        percent: Math.round((r.spend_cents / maxSpend) * 100),
        color: paletteTone(i),
      };
    });
  }, [a]);

  const rangeButtons = (
    <div className="flex items-center gap-1">
      {SOURCING_ANALYTICS_RANGES.map((r) => (
        <Button
          key={r.id}
          variant={r.id === range ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setRange(r.id)}
          className="text-caption font-semibold"
        >
          {r.label}
        </Button>
      ))}
    </div>
  );

  if (isLoading) return <Centered>Loading sourcing analytics…</Centered>;
  if (isError) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center text-caption text-rose-700">
          Could not load sourcing analytics. Try another range or reload.
        </div>
      </div>
    );
  }
  if (!a) return <Empty icon={<BarChart3 className="h-6 w-6" />} title="No sourcing analytics yet" hint="Import a candidate to start the acquisition ledger — spend, fill-rate, and time-to-source land here." />;

  const fillRatePct =
    a.acquisitions.ordered > 0
      ? Math.round((a.acquisitions.received / a.acquisitions.ordered) * 100)
      : null;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-text-default">Sourcing analytics</h1>
        {rangeButtons}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Spend" value={formatCents(a.acquisitions.spend_cents)} sub={`${a.acquisitions.ordered} acquisitions`} />
        <StatTile
          label="Fill rate"
          value={fillRatePct != null ? `${fillRatePct}%` : '—'}
          sub={`${a.acquisitions.received} of ${a.acquisitions.ordered} received`}
        />
        <StatTile
          label="Demand → order"
          value={formatDays(a.demand.avg_days_demand_to_order)}
          sub={`${a.demand.sourced_from_alerts} sourced from the queue`}
        />
        <StatTile
          label="Order → received"
          value={formatDays(a.acquisitions.avg_days_order_to_receive)}
          sub="avg lead time"
        />
      </div>

      <Section title="Spend & acquisitions per week">
        {a.spendByWeek.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-6 text-center text-caption text-text-faint">
            No acquisitions in this range.
          </div>
        ) : (
          <MultiSeriesLineChart series={spendSeries} xLabels={spendLabels} height={220} area />
        )}
      </Section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Section title="Demand fill">
          <GaugeDonut
            centerLabel="Demand"
            segments={[
              { key: 'resolved', label: 'Resolved', value: a.demand.resolved, color: paletteTone(2) },
              { key: 'dismissed', label: 'Dismissed', value: a.demand.dismissed, color: paletteTone(3) },
              {
                key: 'open',
                label: 'Still open',
                value: Math.max(0, a.demand.opened - a.demand.resolved - a.demand.dismissed),
                color: paletteTone(4),
              },
            ]}
          />
          <p className="mt-2 text-center text-caption text-text-faint">
            {a.demand.opened} demand rows opened in this range
          </p>
        </Section>

        <Section title="Acquisition cost vs target">
          <DistributionTable
            columns={['SKU', 'Buys', '%']}
            rows={costRows}
            showBar
            emptyMessage="No priced acquisitions in this range."
          />
        </Section>
      </div>
    </div>
  );
}
