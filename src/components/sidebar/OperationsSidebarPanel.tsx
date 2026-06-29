'use client';

/**
 * Operations master-page sidebar — the single contextual panel for `/operations`.
 *
 * It owns the four-mode switcher (Live · Analytics · Insights · History) and,
 * per mode, the contextual search / filters / quick-nav. The right pane
 * (OperationsWorkspace) is purely visual and reacts to the same `?mode=` /
 * `?range=` / `?section=` / `?q=` URL params. Follows the house sidebar-mode
 * contract (see `.claude/skills/sidebar-mode`): mode lives in the URL, search is
 * rendered by SidebarShell, never a parallel switcher.
 */

import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/utils/_cn';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { SidebarNavOverlaySlider } from '@/components/sidebar/SidebarNavOverlaySlider';
import { OperationsModeToggle } from '@/components/sidebar/operations/OperationsModeToggle';
import { useMasterNavEnabled } from '@/components/sidebar/master-nav/MasterNavContext';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import {
  Activity,
  Database,
  Warehouse,
  Layers,
  MessageSquare,
  PackageCheck,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Wrench,
} from '@/components/Icons';
import { emitAiChatNew, emitAiChatPrompt } from '@/components/ai/ai-chat-events';
import { useQuery } from '@tanstack/react-query';
import { OPERATIONS_QUERY_KEY } from '@/features/operations/components/operations-dashboard-logic';
import type { DashboardData } from '@/features/operations/types';
import {
  ANALYTICS_RANGE_LABELS,
  JOURNEY_DIMENSION_ITEMS,
  parseAnalyticsRange,
  type AnalyticsRange,
  type OperationsMode,
} from '@/components/sidebar/operations/operations-sidebar-shared';
import { useOperationsMode } from '@/components/sidebar/operations/useOperationsMode';
import { useOperationsTimelineUrlState } from '@/components/sidebar/operations/useOperationsTimelineUrlState';
import type { JourneyDimension } from '@/lib/timeline/journey';

const ANALYTICS_RANGES: AnalyticsRange[] = ['24h', '7d', '30d'];

const ANALYTICS_SECTIONS: { id: string; label: string; icon: (p: { className?: string }) => JSX.Element }[] = [
  { id: 'throughput', label: 'Throughput trend', icon: TrendingUp },
  { id: 'stations', label: 'By station', icon: Warehouse },
  { id: 'sources', label: 'By event type', icon: Database },
  { id: 'velocity', label: 'Inventory velocity', icon: Layers },
  { id: 'activity', label: 'Activity map', icon: Activity },
];

const INSIGHTS_CAPABILITIES = [
  { icon: PackageCheck, title: 'Throughput & pace', detail: 'Velocity, tested, FBA intake vs. yesterday' },
  { icon: Database, title: 'Inventory health', detail: 'Stockouts, dead stock, A/B/C velocity tiers' },
  { icon: Wrench, title: 'Exceptions', detail: 'Repair backlog, overdue tests, stuck shipments' },
  { icon: MessageSquare, title: 'Benchmarks', detail: 'Compare today vs. industry-standard ops targets' },
];

const INSIGHTS_PROMPTS = [
  'How does today’s throughput compare to yesterday?',
  'Which SKUs are dead stock and should be liquidated?',
  'Where is the biggest bottleneck in the floor right now?',
  'Suggest a streamlined workflow to cut repair backlog.',
];

export function OperationsSidebarPanel() {
  const { mode, updateMode } = useOperationsMode();
  const masterNavEnabled = useMasterNavEnabled();

  // The mode rail is suppressed when the master-nav drives mode switching
  // (operations isn't in MASTER_NAV_RAIL_PAGES today, so it renders its own).
  const modeToggle = masterNavEnabled ? null : (
    <OperationsModeToggle value={mode} onChange={(id) => updateMode(id as OperationsMode)} />
  );

  if (mode === 'analytics') return <AnalyticsSidebar modeToggle={modeToggle} />;
  if (mode === 'insights') return <InsightsSidebar modeToggle={modeToggle} />;
  if (mode === 'history') return <HistorySidebar modeToggle={modeToggle} />;
  return <LiveSidebar modeToggle={modeToggle} />;
}

// ── Live ────────────────────────────────────────────────────────────────────

function LiveSidebar({ modeToggle }: { modeToggle: React.ReactNode }) {
  const [q, setQ] = useState('');
  // Read-only view of the shared dashboard cache. The right-pane
  // OperationsDashboard owns the fetch + Ably subscription (Live mode mounts
  // both); a second `useOperationsDashboardData` here would double-poll and
  // double-prepend realtime activity (prependActivityEvent does not dedup).
  const { data } = useQuery<DashboardData>({
    queryKey: OPERATIONS_QUERY_KEY,
    queryFn: () => Promise.reject(new Error('operations dashboard cache is produced by the right pane')),
    enabled: false,
    staleTime: Infinity,
  });
  const isLoading = !data;

  const kpis = useMemo(
    () =>
      [
        { key: 'all', label: 'Velocity', tone: 'text-blue-600' },
        { key: 'tested', label: 'Tested', tone: 'text-emerald-600' },
        { key: 'fba', label: 'FBA intake', tone: 'text-violet-600' },
        { key: 'repair', label: 'Repair queue', tone: 'text-orange-600' },
      ] as const,
    [],
  );

  const feed = useMemo(() => {
    const rows = data?.activityFeed ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.summary?.toLowerCase().includes(needle) ||
        r.type?.toLowerCase().includes(needle) ||
        r.actor_name?.toLowerCase().includes(needle),
    );
  }, [data?.activityFeed, q]);

  return (
    <SidebarShell
      search={{ value: q, onChange: setQ, placeholder: 'Search live activity…', variant: 'blue' }}
      bodyClassName="pt-0 pb-6"
    >
      {modeToggle}
      <div className={cn('space-y-4 pt-4')}>
        <div className="grid grid-cols-2 gap-2">
          {kpis.map((k) => {
            const cell = data?.summary?.[k.key];
            return (
              <div key={k.key} className="rounded-xl border border-gray-200 bg-white p-2.5">
                <p className="text-eyebrow font-black uppercase tracking-widest text-gray-500">{k.label}</p>
                <p className={cn('mt-0.5 text-xl font-black tabular-nums leading-none', k.tone)}>
                  {cell ? cell.value.toLocaleString() : isLoading ? '·' : '0'}
                </p>
                <DeltaPill delta={cell?.delta ?? 0} invert={k.key === 'repair'} />
              </div>
            );
          })}
        </div>

        <div>
          <p className={cn(sectionLabel, 'mb-2')}>Live feed</p>
          <ul className="divide-y divide-gray-100">
            {feed.slice(0, 24).map((r) => (
              <li key={r.id} className="flex items-start gap-2 py-1.5">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-400" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-caption font-semibold text-gray-900">{r.summary || r.type}</p>
                  <p className="truncate text-eyebrow font-semibold uppercase tracking-widest text-gray-500">
                    {r.source} · {r.actor_name ?? 'system'}
                  </p>
                </div>
              </li>
            ))}
            {feed.length === 0 && (
              <li className="py-6 text-center text-caption text-gray-400">
                {isLoading ? 'Loading live activity…' : 'No matching activity.'}
              </li>
            )}
          </ul>
        </div>
      </div>
    </SidebarShell>
  );
}

// ── Analytics ─────────────────────────────────────────────────────────────────

function AnalyticsSidebar({ modeToggle }: { modeToggle: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const range = parseAnalyticsRange(searchParams.get('range'));
  const activeSection = searchParams.get('section') ?? '';

  const setParam = useCallback(
    (key: 'range' | 'section', value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('mode', 'analytics');
      params.set(key, value);
      router.replace(`/operations?${params.toString()}`);
    },
    [router, searchParams],
  );

  return (
    <SidebarShell bodyClassName="pt-0 pb-6">
      {modeToggle}
      <div className={cn('space-y-5 pt-3')}>
        <header>
          <h2 className="text-xl font-black uppercase leading-none tracking-tighter text-gray-900">Analytics</h2>
          <p className="mt-1 text-eyebrow font-bold uppercase tracking-widest text-blue-600">
            Trends · breakdowns · inventory health
          </p>
        </header>

        <div>
          <p className={cn(sectionLabel, 'mb-2')}>Time range</p>
          <div className="flex flex-col gap-1">
            {ANALYTICS_RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setParam('range', r)}
                /* ds-raw-button: vertical segmented time-range toggle (selection ring) — not a Button shape */
                className={cn(
                  'ds-raw-button flex items-center justify-between rounded-lg border px-3 py-1.5 text-left text-caption font-semibold transition-colors',
                  range === r
                    ? 'border-blue-400 bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-400'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
                )}
              >
                {ANALYTICS_RANGE_LABELS[r]}
                {range === r && <span className="h-1.5 w-1.5 rounded-full bg-blue-500" aria-hidden />}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className={cn(sectionLabel, 'mb-2')}>Jump to</p>
          <ul className="flex flex-col gap-0.5">
            {ANALYTICS_SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setParam('section', s.id)}
                  /* ds-raw-button: jump-to nav row (icon + label, selection ring) — not a Button shape */
                  className={cn(
                    'ds-raw-button flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-caption font-semibold transition-colors',
                    activeSection === s.id
                      ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-400'
                      : 'text-gray-700 hover:bg-gray-50',
                  )}
                >
                  <s.icon className="h-3.5 w-3.5 text-gray-400" />
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SidebarShell>
  );
}

// ── Insights (AI) ─────────────────────────────────────────────────────────────

function InsightsSidebar({ modeToggle }: { modeToggle: React.ReactNode }) {
  return (
    <SidebarShell bodyClassName="pt-0 pb-6">
      {modeToggle}
      <div className={cn('space-y-5 pt-3')}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-900 text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <p className="text-base font-semibold tracking-tight text-gray-900">Ops Assistant</p>
          </div>
          <HoverTooltip label="New chat" asChild>
            <IconButton
              icon={<RefreshCw className="h-4 w-4" />}
              ariaLabel="New chat"
              onClick={() => emitAiChatNew()}
              className="-my-1 rounded-md p-1.5 hover:bg-gray-100"
            />
          </HoverTooltip>
        </div>

        <p className="text-caption leading-5 text-gray-600">
          Ask about the floor in plain English. The assistant streams its reply in the panel on the
          right with live operations + inventory context.
        </p>

        <div className="flex flex-col gap-2.5">
          {INSIGHTS_CAPABILITIES.map((c) => (
            <div key={c.title} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex items-center gap-2 text-gray-900">
                <c.icon className="h-4 w-4 text-blue-500" />
                <p className="text-caption font-semibold tracking-tight">{c.title}</p>
              </div>
              <p className="mt-1 text-micro leading-5 text-gray-600">{c.detail}</p>
            </div>
          ))}
        </div>

        <div>
          <p className="text-micro font-black uppercase tracking-[0.2em] text-gray-500">Try asking</p>
          <div className="mt-3 flex flex-col gap-2">
            {INSIGHTS_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => emitAiChatPrompt(p)}
                /* ds-raw-button: multi-line text-left prompt suggestion card — not a Button shape */
                className="ds-raw-button rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-caption leading-5 text-gray-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-gray-900"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
    </SidebarShell>
  );
}

// ── History ───────────────────────────────────────────────────────────────────

function HistorySidebar({ modeToggle }: { modeToggle: React.ReactNode }) {
  const url = useOperationsTimelineUrlState();

  const placeholder =
    url.dim === 'order'
      ? 'Search an order number…'
      : url.dim === 'serial'
        ? 'Search a serial number…'
        : 'Search a tracking number…';

  // Pure record lookup: pick a dimension, paste a number. The right pane teaches
  // the empty state; the body stays clean (no date/station/type/saved-view rails).
  return (
    <SidebarShell
      search={{
        value: url.entityValue,
        onChange: (v) => url.setEntity(v),
        placeholder,
        variant: 'blue',
        debounceMs: 250,
      }}
      bodyClassName="pt-0"
    >
      {modeToggle}
      <SidebarNavOverlaySlider
        items={JOURNEY_DIMENSION_ITEMS}
        value={url.dim}
        onChange={(id) => url.setDim(id as JourneyDimension)}
        aria-label="Journey dimension"
      />
    </SidebarShell>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function DeltaPill({ delta, invert = false }: { delta: number; invert?: boolean }) {
  if (!delta) return <p className="mt-1 text-eyebrow font-semibold text-gray-400">No change</p>;
  const positive = invert ? delta < 0 : delta > 0;
  return (
    <p
      className={cn(
        'mt-1 inline-flex items-center gap-0.5 text-eyebrow font-black tabular-nums',
        positive ? 'text-emerald-600' : 'text-rose-600',
      )}
    >
      <TrendingUp className={cn('h-3 w-3', delta < 0 && 'rotate-180')} />
      {delta > 0 ? '+' : ''}
      {delta}%
    </p>
  );
}
