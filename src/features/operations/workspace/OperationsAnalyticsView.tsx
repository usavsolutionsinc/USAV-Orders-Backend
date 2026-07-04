'use client';

/**
 * Operations → Analytics mode. The deep-analytics dashboard, modelled on the
 * dark analytics reference: a throughput hero line chart, a stations gauge /
 * sources / inventory-velocity tri-panel, and a bottom activity map +
 * inventory-health strip. It renders clean on the light canvas and becomes the
 * dark reference automatically under `html[data-theme='dark']` (semantic classes
 * only — no hardcoded dark theme).
 *
 * Data comes from existing org-scoped endpoints via `useOperationsAnalytics`
 * (kpi-table + reports), plus the cached `useOperationsDashboardData` for the
 * top KPI strip. No new backend, no polling.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { cn } from '@/utils/_cn';
import { Button } from '@/design-system/primitives';
import { Activity, BarChart3, Boxes, Database, Download, Layers, Loader2, TrendingUp, Warehouse, Zap } from '@/components/Icons';
import {
  ANALYTICS_RANGE_LABELS,
  parseAnalyticsRange,
  type AnalyticsRange,
} from '@/components/sidebar/operations/operations-sidebar-shared';
import { useOperationsDashboardData } from '@/features/operations/components/useOperationsDashboardData';
import type { DashboardCategory } from '@/features/operations/types';
import { useOperationsAnalytics } from './useOperationsAnalytics';
import { useOperationsRoi } from './useOperationsRoi';
import { BenchmarksSection } from './BenchmarksSection';
import { MultiSeriesLineChart, type LineSeries } from './charts/MultiSeriesLineChart';
import { GaugeDonut } from './charts/GaugeDonut';
import { DistributionTable, type DistributionRow } from './charts/DistributionTable';
import { ActivityHeatmap, type HeatCell } from './charts/ActivityHeatmap';
import { paletteTone, stationTone, VELOCITY_TIER_TONES } from './charts/chart-theme';

const RANGES: AnalyticsRange[] = ['24h', '7d', '30d'];

const KPI_STRIP: { key: DashboardCategory; label: string; tone: string; invert?: boolean }[] = [
  { key: 'all', label: 'Daily velocity', tone: 'text-blue-600' },
  { key: 'tested', label: 'Tested today', tone: 'text-emerald-600' },
  { key: 'fba', label: 'FBA intake', tone: 'text-violet-600' },
  { key: 'repair', label: 'Repair queue', tone: 'text-orange-600', invert: true },
];

const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const } },
};

type Segment = 'volume' | 'cumulative';

function formatBucketLabel(at: string, granularity: 'hourly' | 'daily'): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  if (granularity === 'daily') return `${d.getMonth() + 1}/${d.getDate()}`;
  let h = d.getHours();
  const ap = h < 12 ? 'a' : 'p';
  h %= 12;
  if (h === 0) h = 12;
  return `${h}${ap}`;
}

function movingAverage(values: number[], window = 5): number[] {
  if (values.length === 0) return [];
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length - 1, i + half);
    let sum = 0;
    for (let j = lo; j <= hi; j += 1) sum += values[j];
    return sum / (hi - lo + 1);
  });
}

export function OperationsAnalyticsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const range = parseAnalyticsRange(searchParams.get('range'));
  const section = searchParams.get('section');
  const [segment, setSegment] = useState<Segment>('volume');

  const analytics = useOperationsAnalytics(range);
  const { data: dashboard } = useOperationsDashboardData();
  const a = analytics.data;

  // Sidebar "Jump to" → scroll the matching section into view.
  useEffect(() => {
    if (!section) return;
    const el = document.getElementById(`ops-analytics-${section}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [section]);

  const setRange = useCallback(
    (next: AnalyticsRange) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('mode', 'analytics');
      params.set('range', next);
      router.replace(`/operations?${params.toString()}`);
    },
    [router, searchParams],
  );

  const series = useMemo<LineSeries[]>(() => {
    const values = (a?.buckets ?? []).map((b) => b.value);
    if (segment === 'cumulative') {
      let acc = 0;
      const cumulative = values.map((v) => (acc += v));
      return [{ key: 'cumulative', label: 'Cumulative events', color: paletteTone(0), points: cumulative }];
    }
    return [
      { key: 'events', label: 'Events', color: paletteTone(0), points: values },
      { key: 'trend', label: 'Trend (avg)', color: paletteTone(1), points: movingAverage(values) },
    ];
  }, [a?.buckets, segment]);

  const xLabels = useMemo(
    () => (a?.buckets ?? []).map((b) => formatBucketLabel(b.at, analytics.granularity)),
    [a?.buckets, analytics.granularity],
  );

  const stationRows = useMemo<DistributionRow[]>(
    () =>
      (a?.byStation ?? []).map((d) => ({
        key: d.label,
        label: d.label,
        count: d.count,
        percent: d.percent,
        color: stationTone(d.label),
      })),
    [a?.byStation],
  );

  const typeRows = useMemo<DistributionRow[]>(
    () =>
      (a?.byType ?? []).map((d, i) => ({
        key: d.label,
        label: prettyEventType(d.label),
        count: d.count,
        percent: d.percent,
        color: paletteTone(i),
      })),
    [a?.byType],
  );

  const tierRows = useMemo<DistributionRow[]>(
    () =>
      (a?.velocityTiers ?? []).map((t) => ({
        key: t.tier,
        label: `Tier ${t.tier}`,
        sublabel: TIER_BLURB[t.tier],
        count: t.count,
        percent: t.percent,
        color: VELOCITY_TIER_TONES[t.tier],
      })),
    [a?.velocityTiers],
  );

  const heatmap = useMemo(() => buildHeatmap(a?.buckets ?? [], analytics.granularity), [a?.buckets, analytics.granularity]);

  const exportReport = useCallback(() => {
    if (!a || typeof window === 'undefined') return;
    const lines: string[] = [];
    lines.push(`Operations Analytics — ${ANALYTICS_RANGE_LABELS[range]}`);
    lines.push('');
    lines.push('Throughput,timestamp,events');
    a.buckets.forEach((b) => lines.push(`,${b.at},${b.value}`));
    lines.push('');
    lines.push('By station,label,count,percent');
    a.byStation.forEach((d) => lines.push(`,${d.label},${d.count},${d.percent.toFixed(1)}`));
    lines.push('');
    lines.push('By event type,label,count,percent');
    a.byType.forEach((d) => lines.push(`,${d.label},${d.count},${d.percent.toFixed(1)}`));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `operations-analytics-${range}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [a, range]);

  const loading = analytics.isLoading;

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto bg-surface-canvas text-text-default">
      <motion.main
        variants={container}
        initial="hidden"
        animate="visible"
        className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-16 space-y-6"
      >
        {/* header */}
        <motion.header variants={item} className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/10 text-blue-600">
              <BarChart3 className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-text-default leading-none">Operations Analytics</h1>
              <p className="mt-1 text-eyebrow font-bold uppercase tracking-widest text-text-soft">
                {ANALYTICS_RANGE_LABELS[range]} · live floor + inventory
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Segmented
              value={segment}
              onChange={(v) => setSegment(v)}
              options={[
                { id: 'volume', label: 'Volume' },
                { id: 'cumulative', label: 'Cumulative' },
              ]}
            />
            <Segmented value={range} onChange={setRange} options={RANGES.map((r) => ({ id: r, label: RANGE_SHORT[r] }))} />
            <Button
              variant="secondary"
              size="sm"
              icon={<Download className="h-4 w-4" />}
              onClick={exportReport}
              disabled={!a}
            >
              Create report
            </Button>
          </div>
        </motion.header>

        {/* KPI strip */}
        <motion.section variants={item} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {KPI_STRIP.map((k) => {
            const cell = dashboard?.summary?.[k.key];
            return (
              <div key={k.key} className="rounded-2xl border border-border-soft bg-surface-card p-4">
                <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">{k.label}</p>
                <p className={cn('mt-1.5 text-3xl font-black tabular-nums leading-none', k.tone)}>
                  {cell ? cell.value.toLocaleString() : '0'}
                </p>
                <Delta delta={cell?.delta ?? 0} invert={k.invert} />
              </div>
            );
          })}
        </motion.section>

        {/* Throughput & ROI — the first-week proof (lead with the big numbers) */}
        <RoiSection />

        {/* hero — throughput */}
        <SectionCard
          id="throughput"
          icon={TrendingUp}
          eyebrow="Throughput"
          title="Total operations events"
          headline={a ? a.totals.events.toLocaleString() : loading ? '—' : '0'}
          meta={`${a?.totals.uniqueEntities.toLocaleString() ?? 0} unique units`}
        >
          <MultiSeriesLineChart series={series} xLabels={xLabels} height={280} area />
        </SectionCard>

        {/* tri-panel */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <SectionCard id="stations" icon={Warehouse} eyebrow="Distribution" title="By station">
            <GaugeDonut
              centerLabel="Events"
              segments={(a?.byStation ?? []).map((d) => ({
                key: d.label,
                label: d.label,
                value: d.count,
                color: stationTone(d.label),
              }))}
            />
            <div className="mt-4">
              <DistributionTable columns={['Station', 'Events', '%']} rows={stationRows} emptyMessage="No station activity." />
            </div>
          </SectionCard>

          <SectionCard id="sources" icon={Database} eyebrow="Distribution" title="By event type">
            <DistributionTable columns={['Event type', 'Events', '%']} rows={typeRows} emptyMessage="No events in this range." />
            <p className="mt-4 text-micro leading-5 text-text-soft">
              Lifecycle events (received → tested → packed → shipped) from the org-scoped event log.
            </p>
          </SectionCard>

          <SectionCard id="velocity" icon={Layers} eyebrow="Inventory" title="Velocity tiers">
            {a?.velocityAvailable ? (
              <>
                <DistributionTable columns={['Tier', 'SKUs', '%']} rows={tierRows} showBar emptyMessage="No SKUs scored." />
                <p className="mt-4 text-micro leading-5 text-text-soft">
                  ABC analysis by 30-day outbound movement. Tier A = fastest movers.
                </p>
              </>
            ) : (
              <Locked label="Requires the “View reports” permission." />
            )}
          </SectionCard>
        </div>

        {/* you vs typical — seeded vertical benchmarks (plan §2.5, Phase 1) */}
        <SectionCard id="benchmarks" icon={BarChart3} eyebrow="Benchmarks" title="You vs typical">
          <BenchmarksSection rangeDays={range === '24h' ? 1 : range === '7d' ? 7 : 30} />
        </SectionCard>

        {/* activity map + inventory health */}
        <SectionCard id="activity" icon={Activity} eyebrow="When work happens" title="Operations activity map">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
            <div className="grid grid-cols-2 gap-3">
              <HealthTile icon={Boxes} label="Dead-stock SKUs" value={a?.deadStockCount ?? null} tone="text-rose-600" />
              <HealthTile
                icon={Zap}
                label="A-tier movers"
                value={a?.velocityAvailable ? Math.round(a.velocityTiers[0]?.percent ?? 0) : null}
                suffix="%"
                tone="text-emerald-600"
              />
              <HealthTile icon={Activity} label="Total events" value={a?.totals.events ?? null} tone="text-blue-600" />
              <HealthTile icon={TrendingUp} label="Exceptions" value={a?.totals.exceptions ?? null} tone="text-orange-600" />
            </div>
            <div className="min-w-0">
              <ActivityHeatmap
                rows={heatmap.rows}
                cols={heatmap.cols}
                cells={heatmap.cells}
                rowLabels={heatmap.rowLabels}
                colLabels={heatmap.colLabels}
                color={paletteTone(0)}
              />
              <p className="mt-2 text-micro leading-5 text-text-soft">
                Each dot is {analytics.granularity === 'daily' ? 'a day' : 'an hour'} of floor activity; brighter = busier.
                {a?.truncated ? ` Showing the latest ${analytics.eventsLimit.toLocaleString()} events.` : ''}
              </p>
            </div>
          </div>
        </SectionCard>
      </motion.main>
    </div>
  );
}

// ── sub-components ─────────────────────────────────────────────────────────────

const RANGE_SHORT: Record<AnalyticsRange, string> = { '24h': '24h', '7d': '7d', '30d': '30d' };

const TIER_BLURB: Record<'A' | 'B' | 'C' | 'D', string> = {
  A: 'Fast movers',
  B: 'Steady',
  C: 'Slow',
  D: 'Dormant',
};

/** RECEIVED → Received, TEST_PASS → Test pass. */
function prettyEventType(raw: string): string {
  const lower = raw.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-border-soft bg-surface-canvas p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            'ds-raw-button rounded-md px-2.5 py-1 text-eyebrow font-black uppercase tracking-widest transition-colors',
            value === o.id ? 'bg-surface-card text-text-default shadow-sm' : 'text-text-soft hover:text-text-default',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SectionCard({
  id,
  icon: Icon,
  eyebrow,
  title,
  headline,
  meta,
  children,
}: {
  id: string;
  icon: (p: { className?: string }) => JSX.Element;
  eyebrow: string;
  title: string;
  headline?: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      variants={item}
      id={`ops-analytics-${id}`}
      className="scroll-mt-6 rounded-2xl border border-border-soft bg-surface-card p-5 sm:p-6"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-text-faint" />
          <div>
            <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">{eyebrow}</p>
            <h2 className="text-base font-black tracking-tight text-text-default leading-tight">{title}</h2>
          </div>
        </div>
        {(headline || meta) && (
          <div className="text-right">
            {headline && <p className="text-2xl font-black tabular-nums leading-none text-text-default">{headline}</p>}
            {meta && <p className="mt-1 text-eyebrow font-semibold uppercase tracking-widest text-text-faint">{meta}</p>}
          </div>
        )}
      </div>
      {children}
    </motion.section>
  );
}

function Delta({ delta, invert = false }: { delta: number; invert?: boolean }) {
  if (!delta) return <p className="mt-1.5 text-eyebrow font-semibold text-text-faint">No change vs. yesterday</p>;
  const positive = invert ? delta < 0 : delta > 0;
  return (
    <p
      className={cn(
        'mt-1.5 inline-flex items-center gap-0.5 text-caption font-black tabular-nums',
        positive ? 'text-emerald-600' : 'text-rose-600',
      )}
    >
      <TrendingUp className={cn('h-3.5 w-3.5', delta < 0 && 'rotate-180')} />
      {delta > 0 ? '+' : ''}
      {delta}% vs. yesterday
    </p>
  );
}

function HealthTile({
  icon: Icon,
  label,
  value,
  suffix = '',
  tone,
}: {
  icon: (p: { className?: string }) => JSX.Element;
  label: string;
  value: number | null;
  suffix?: string;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-border-soft bg-surface-card p-3">
      <div className="flex items-center gap-1.5 text-text-faint">
        <Icon className="h-3.5 w-3.5" />
        <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">{label}</p>
      </div>
      <p className={cn('mt-1.5 text-2xl font-black tabular-nums leading-none', tone)}>
        {value === null ? '—' : `${value.toLocaleString()}${suffix}`}
      </p>
    </div>
  );
}

function Locked({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-8 text-center text-caption font-semibold text-text-faint">
      {label}
    </div>
  );
}

// ── Throughput & ROI section (first-week proof) ─────────────────────────────────

/** Compact hours readout: <1h → minutes, else 1-dp hours. */
function formatHours(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return '—';
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
}

function RoiDelta({ pct }: { pct: number }) {
  if (!pct) {
    return <span className="text-eyebrow font-semibold uppercase tracking-widest text-text-faint">No change vs. last week</span>;
  }
  const positive = pct > 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-caption font-black tabular-nums',
        positive ? 'text-emerald-600' : 'text-rose-600',
      )}
    >
      <TrendingUp className={cn('h-3.5 w-3.5', pct < 0 && 'rotate-180')} />
      {pct > 0 ? '+' : ''}
      {pct}% vs. last week
    </span>
  );
}

function RoiTile({
  icon: Icon,
  label,
  value,
  tone,
  footer,
}: {
  icon: (p: { className?: string }) => JSX.Element;
  label: string;
  value: string;
  tone: string;
  footer: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border-soft bg-surface-card p-4">
      <div className="flex items-center gap-1.5 text-text-faint">
        <Icon className="h-3.5 w-3.5" />
        <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">{label}</p>
      </div>
      <p className={cn('mt-1.5 text-3xl font-black tabular-nums leading-none', tone)}>{value}</p>
      <div className="mt-1.5">{footer}</div>
    </div>
  );
}

function RoiSection() {
  const { data: roi, isLoading } = useOperationsRoi();

  const staffRows = useMemo<DistributionRow[]>(() => {
    if (!roi) return [];
    const total = roi.perStaff.reduce((s, p) => s + p.unitsProcessed, 0) || 1;
    return roi.perStaff.slice(0, 8).map((p, i) => ({
      key: String(p.staffId),
      label: p.staffName,
      sublabel: `${p.unitsPerLaborHour}/hr · ${p.laborHours.toLocaleString()}h`,
      count: p.unitsProcessed,
      percent: (p.unitsProcessed / total) * 100,
      color: paletteTone(i),
    }));
  }, [roi]);

  return (
    <motion.section
      variants={item}
      id="ops-analytics-roi"
      className="scroll-mt-6 rounded-2xl border border-border-soft bg-surface-card p-5 sm:p-6"
    >
      <div className="mb-4 flex items-center gap-2">
        <Zap className="h-4 w-4 text-text-faint" />
        <div>
          <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">First-week proof</p>
          <h2 className="text-base font-black tracking-tight text-text-default leading-tight">Throughput &amp; ROI</h2>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 px-1 py-8 text-caption font-semibold text-text-faint">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading ROI…
        </div>
      ) : !roi || !roi.hasData ? (
        <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-10 text-center">
          <p className="text-caption font-bold text-text-muted">No throughput captured yet</p>
          <p className="mx-auto mt-1 max-w-md text-micro leading-5 text-text-soft">
            As units move through your stations and staff clock in, this fills with units per labor-hour and
            week-over-week lift — the proof your floor is getting faster.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <RoiTile
              icon={TrendingUp}
              label="Units this week"
              value={roi.unitsThisWeek.toLocaleString()}
              tone="text-blue-600"
              footer={<RoiDelta pct={roi.pctChange} />}
            />
            <RoiTile
              icon={Zap}
              label="Units / labor-hour"
              value={roi.unitsPerLaborHour.toLocaleString()}
              tone="text-emerald-600"
              footer={
                <span className="text-eyebrow font-semibold uppercase tracking-widest text-text-faint">
                  {roi.unitsProcessed.toLocaleString()} units · {roi.laborHours.toLocaleString()}h clocked
                </span>
              }
            />
            <RoiTile
              icon={Layers}
              label="Units stuck"
              value={roi.unitsStuck.toLocaleString()}
              tone={roi.unitsStuck > 0 ? 'text-orange-600' : 'text-text-default'}
              footer={
                <span className="text-eyebrow font-semibold uppercase tracking-widest text-text-faint">
                  Blocked + error now
                </span>
              }
            />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-eyebrow font-black uppercase tracking-widest text-text-soft">
                Avg cycle time by stage
              </p>
              {roi.avgCycleHoursByStage.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-6 text-center text-caption text-text-faint">
                  No completed stage runs in the last 7 days.
                </div>
              ) : (
                <ul className="divide-y divide-border-hairline">
                  {roi.avgCycleHoursByStage.map((s) => (
                    <li key={s.stage} className="flex items-center justify-between py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-caption font-semibold text-text-default">
                          {prettyEventType(s.stage)}
                        </span>
                        <span className="block text-eyebrow font-semibold uppercase tracking-widest text-text-faint">
                          {s.samples.toLocaleString()} runs
                        </span>
                      </span>
                      <span className="shrink-0 text-caption font-bold tabular-nums text-text-default">
                        {formatHours(s.avgCycleHours)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-2 text-eyebrow font-black uppercase tracking-widest text-text-soft">
                Units / hour by staff
              </p>
              <DistributionTable
                columns={['Staff', 'Units', '%']}
                rows={staffRows}
                emptyMessage="No staff throughput yet."
                showBar
              />
            </div>
          </div>
        </>
      )}
    </motion.section>
  );
}

// ── heatmap model ──────────────────────────────────────────────────────────────

function buildHeatmap(
  buckets: { at: string; value: number }[],
  granularity: 'hourly' | 'daily',
): { rows: number; cols: number; cells: HeatCell[]; rowLabels: string[]; colLabels: string[] } {
  if (buckets.length === 0) {
    return { rows: granularity === 'daily' ? 5 : 1, cols: granularity === 'daily' ? 7 : 24, cells: [], rowLabels: [], colLabels: [] };
  }

  if (granularity === 'daily') {
    const first = new Date(buckets[0].at);
    if (Number.isNaN(first.getTime())) {
      return { rows: 5, cols: 7, cells: [], rowLabels: [], colLabels: ['S', 'M', 'T', 'W', 'T', 'F', 'S'] };
    }
    first.setHours(0, 0, 0, 0);
    // Normalize rows to calendar weeks (Sunday-aligned) so day columns and week
    // rows stay consistent regardless of which weekday the range starts on.
    const firstSunday = new Date(first);
    firstSunday.setDate(firstSunday.getDate() - first.getDay());
    const cells: HeatCell[] = [];
    let maxWeek = 0;
    for (const b of buckets) {
      const d = new Date(b.at);
      if (Number.isNaN(d.getTime())) continue;
      const week = Math.max(0, Math.floor((d.getTime() - firstSunday.getTime()) / (7 * 86_400_000)));
      const col = d.getDay();
      maxWeek = Math.max(maxWeek, week);
      if (b.value > 0) cells.push({ row: week, col, value: b.value });
    }
    return {
      rows: maxWeek + 1,
      cols: 7,
      cells,
      rowLabels: Array.from({ length: maxWeek + 1 }, (_, i) => `W${i + 1}`),
      colLabels: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
    };
  }

  // hourly → rows = distinct dates, cols = 24 hours
  const dateOrder: string[] = [];
  const dateRow = new Map<string, number>();
  const cells: HeatCell[] = [];
  for (const b of buckets) {
    const d = new Date(b.at);
    if (Number.isNaN(d.getTime())) continue;
    const key = d.toDateString();
    if (!dateRow.has(key)) {
      dateRow.set(key, dateOrder.length);
      dateOrder.push(key);
    }
    const row = dateRow.get(key)!;
    if (b.value > 0) cells.push({ row, col: d.getHours(), value: b.value });
  }
  return {
    rows: dateOrder.length,
    cols: 24,
    cells,
    rowLabels: dateOrder.map((k) => {
      const d = new Date(k);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    }),
    colLabels: Array.from({ length: 24 }, (_, h) => {
      const ap = h < 12 ? 'a' : 'p';
      let hh = h % 12;
      if (hh === 0) hh = 12;
      return `${hh}${ap}`;
    }),
  };
}
