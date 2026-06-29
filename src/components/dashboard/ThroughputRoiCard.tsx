'use client';

/**
 * Throughput ROI hero card — the first-week "is this paying off?" proof for the
 * Unshipped sidebar (and any other surface that mounts it).
 *
 * Leads with the HERO number (units captured this week) + a Δ chip vs last week,
 * then the headline ROI metric (units / labor-hour) and a gentle attention stat
 * (units stuck). One glance tells a trialing owner whether the throughput lift is
 * real.
 *
 * Data: the existing org-scoped `useOperationsRoi` hook (GET /api/operations/roi,
 * staleTime 5min — a glance metric, no polling). It is the Monitor archetype: a
 * read-only rollup, no selection, no mutation.
 *
 * Gating: the same `operations.view` permission the endpoint requires. The data
 * hook is mounted by a child component so it never fetches (or flashes) for a
 * user who can't see operations — the gate returns null first.
 *
 * States: loading (Loader2 + text) · error / no-data-from-fetch (quiet null,
 * never crashes the dashboard) · `hasData === false` (quiet null — the sibling
 * `FirstScanOnboardingCard` owns the brand-new-shop first-run state, so the two
 * never stack a "no data yet" box) · `hasData === true` (the hero).
 */

import { useAuth } from '@/contexts/AuthContext';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import {
  TrendingUp,
  ChevronUp,
  ChevronDown,
  Minus,
  AlertTriangle,
  Loader2,
} from '@/components/Icons';
import {
  useOperationsRoi,
  type OperationsRoiData,
} from '@/features/operations/workspace/useOperationsRoi';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { cn } from '@/utils/_cn';

const BAND = 'shrink-0 border-b border-gray-100 bg-white px-4 py-3';
const EYEBROW = 'text-eyebrow font-black uppercase tracking-widest text-gray-500';

/**
 * Permission gate. Rendering the data-owning inner component conditionally keeps
 * `useOperationsRoi` from mounting at all for a user without `operations.view`,
 * so there is no wasted/403 fetch and no flash of an unauthorized card.
 */
export function ThroughputRoiCard({ variant = 'band' }: { variant?: 'band' | 'sidebar' }) {
  const { isLoaded, has } = useAuth();
  if (!isLoaded || !has('operations.view')) return null;
  return <ThroughputRoiCardInner variant={variant} />;
}

function ThroughputRoiCardInner({ variant }: { variant: 'band' | 'sidebar' }) {
  const { data, isLoading, isError } = useOperationsRoi();

  if (isLoading) {
    return (
      <section className={shellClass(variant)} aria-busy="true">
        <RoiEyebrow />
        <div className="mt-1.5 flex items-center gap-2 text-caption font-semibold text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading throughput…
        </div>
      </section>
    );
  }

  // Quiet degrade: the hook resolves any error / non-OK response to null, so a
  // failed fetch simply renders nothing — it must never crash or clutter the
  // dashboard.
  if (isError || !data) return null;

  // Brand-new org (zero throughput): stay quiet. The sibling
  // `FirstScanOnboardingCard` (mounted alongside in UnshippedSidebar) owns
  // the first-run "scan your first unit" state, so we render nothing here to
  // avoid stacking two "no data yet" boxes. It lights up once throughput exists.
  if (!data.hasData) return null;

  return <RoiHero data={data} variant={variant} />;
}

const shellClass = (variant: 'band' | 'sidebar') =>
  variant === 'sidebar' ? cn('bg-white', SIDEBAR_GUTTER) : BAND;

function RoiHero({ data, variant }: { data: OperationsRoiData; variant: 'band' | 'sidebar' }) {
  const { unitsThisWeek, unitsLastWeek, pctChange, unitsPerLaborHour, unitsStuck } = data;
  const sidebar = variant === 'sidebar';
  return (
    <section className={shellClass(variant)} aria-label="First-week throughput ROI">
      <div className={sidebar ? 'space-y-3' : 'flex items-center justify-between gap-4'}>
        {/* HERO — units this week + Δ vs last week. */}
        <div className="min-w-0">
          <RoiEyebrow />
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className={`font-black leading-none tabular-nums text-gray-900 ${sidebar ? 'text-2xl' : 'text-3xl'}`}>
              {unitsThisWeek.toLocaleString()}
            </span>
            <span className="text-caption font-semibold uppercase tracking-wide text-gray-400">
              units
            </span>
            <DeltaChip pct={pctChange} lastWeek={unitsLastWeek} />
          </div>
        </div>

        {/* SECONDARY — the headline ROI metric + a gentle attention stat. */}
        <div
          className={
            sidebar
              ? 'grid grid-cols-2 gap-2 border-t border-gray-100 pt-3'
              : 'flex shrink-0 items-center divide-x divide-gray-100'
          }
        >
          <SecondaryStat
            label="Units / labor-hr"
            value={unitsPerLaborHour > 0 ? unitsPerLaborHour.toFixed(1) : '0'}
            tooltip="Units advanced per clocked labor-hour over the last 7 days — the headline ROI metric."
            compact={sidebar}
          />
          <StuckStat value={unitsStuck} compact={sidebar} />
        </div>
      </div>
    </section>
  );
}

/** Eyebrow header, shared across hero / loading / empty so the framing is constant. */
function RoiEyebrow() {
  return (
    <HoverTooltip
      label="Stage-completions captured over the last 7 days — your first-week throughput proof."
      focusable={false}
    >
      <span className="inline-flex items-center gap-1.5">
        <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
        <span className={EYEBROW}>Throughput this week</span>
      </span>
    </HoverTooltip>
  );
}

/** Week-over-week delta chip: emerald up · rose down · gray flat. */
function DeltaChip({ pct, lastWeek }: { pct: number; lastWeek: number }) {
  const tone =
    pct > 0
      ? { chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', Icon: ChevronUp }
      : pct < 0
        ? { chip: 'bg-rose-50 text-rose-700 ring-rose-200', Icon: ChevronDown }
        : { chip: 'bg-gray-50 text-gray-600 ring-gray-200', Icon: Minus };
  const Icon = tone.Icon;
  const label = `${pct > 0 ? '+' : ''}${pct}%`;
  return (
    <HoverTooltip label={`vs last week (${lastWeek.toLocaleString()} units)`} focusable={false}>
      <span
        className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-micro font-black uppercase tracking-widest ring-1 ring-inset ${tone.chip}`}
      >
        <Icon className="h-3 w-3" />
        {label}
      </span>
    </HoverTooltip>
  );
}

function SecondaryStat({
  label,
  value,
  tooltip,
  compact = false,
}: {
  label: string;
  value: string;
  tooltip: string;
  compact?: boolean;
}) {
  return (
    <HoverTooltip asChild label={tooltip} focusable={false}>
      <div className={compact ? 'min-w-0' : 'px-3'}>
        <p className={EYEBROW}>{label}</p>
        <p className={`mt-0.5 font-bold tabular-nums text-gray-900 ${compact ? 'text-sm' : 'text-base'}`}>{value}</p>
      </div>
    </HoverTooltip>
  );
}

/** Units stuck (blocked + error): amber attention tone only when there are any. */
function StuckStat({ value, compact = false }: { value: number; compact?: boolean }) {
  const attention = value > 0;
  return (
    <HoverTooltip
      asChild
      label="Units currently blocked or in error across all stations."
      focusable={false}
    >
      <div className={compact ? 'min-w-0' : 'px-3'}>
        <p className={EYEBROW}>Units stuck</p>
        <div className="mt-0.5 flex items-center gap-1">
          {attention ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> : null}
          <p
            className={`font-bold tabular-nums ${compact ? 'text-sm' : 'text-base'} ${attention ? 'text-amber-700' : 'text-gray-900'}`}
          >
            {value}
          </p>
        </div>
      </div>
    </HoverTooltip>
  );
}
