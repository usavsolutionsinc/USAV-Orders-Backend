'use client';

/**
 * Mobile-first rack detail view.
 *
 * Reached by scanning a rack QR (which routes to
 * `/warehouse?tab=racks&code={flat}`) or by tapping a rack cell on the
 * warehouse map. Shows the "rack face" — every position on the picked
 * level laid out horizontally as fill-coded tiles — with an expander
 * that surfaces the other levels of the same bay for cross-level
 * putaway / picking.
 *
 * The component is a pure read-of-state view over `useBinsOverview`;
 * tap a position to open the existing `BinDetailFlyout` for the full
 * bin record. Putaway / pick task flows are intentionally out of scope
 * for this first cut — see the followup ticket in the task list.
 */

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useBinsOverview, type BinsOverviewRow } from '@/hooks/useBinsOverview';
import { useLocations } from '@/hooks/useLocations';
import { BinDetailFlyout } from './BinDetailFlyout';
import { ChevronDown, ChevronLeft, Layers, Printer } from '@/components/Icons';
import { PaneHeader, PaneHeaderStatusPill } from '@/components/ui/pane-header';
import {
  bayHand,
  noPad,
  pad2,
  parseLocationCodeFlat,
  type LocationSegments,
} from '@/lib/barcode-routing';

interface RackDetailViewProps {
  /** Flat rack code from `?code=` — e.g. "A0101100". */
  code: string;
}

type ViewMode = 'face' | 'list';

export function RackDetailView({ code }: RackDetailViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const segments = useMemo(() => parseLocationCodeFlat(code), [code]);

  const [mode, setMode] = useState<ViewMode>('face');
  const [neighborsOpen, setNeighborsOpen] = useState(false);
  const [flyoutRow, setFlyoutRow] = useState<BinsOverviewRow | null>(null);

  const { rooms } = useLocations();
  const { rows, loading, refetch } = useBinsOverview({ pollMs: 30_000 });

  // Resolve the room name from the zone letter (server-of-record map).
  const roomName = useMemo(() => {
    if (!segments) return null;
    const hit = rooms.find((r) => r.zone_letter === segments.zone);
    return (hit?.room || hit?.name) ?? null;
  }, [rooms, segments]);

  // Bins that live on this aisle/bay (any level). row_label is stored
  // as "AA-BB"; col_label as "L-PP" (L unpadded, PP 2-digit). The rack
  // label row itself uses PP=00 — exclude it from the position grid.
  const bayRows = useMemo(() => {
    if (!segments) return [];
    const rowKey = `${pad2(segments.aisle)}-${pad2(segments.bay)}`;
    return rows.filter((r) => r.row_label === rowKey && !!r.col_label);
  }, [rows, segments]);

  // Group bins by level → array of positions sorted ascending.
  const byLevel = useMemo(() => {
    const out = new Map<number, BinsOverviewRow[]>();
    for (const r of bayRows) {
      const parts = (r.col_label || '').split('-');
      const lv = parseInt(parts[0] ?? '', 10);
      const pos = parseInt(parts[1] ?? '', 10);
      if (!Number.isFinite(lv) || !Number.isFinite(pos)) continue;
      if (pos === 0) continue; // skip the rack-level sentinel row
      if (!out.has(lv)) out.set(lv, []);
      out.get(lv)!.push(r);
    }
    for (const [, list] of out) {
      list.sort((a, b) => {
        const pa = parseInt((a.col_label || '').split('-')[1] ?? '0', 10);
        const pb = parseInt((b.col_label || '').split('-')[1] ?? '0', 10);
        return pa - pb;
      });
    }
    return out;
  }, [bayRows]);

  const back = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('code');
    params.set('tab', 'racks');
    router.replace(`/warehouse?${params.toString()}`);
  };

  if (!segments) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        <p className="font-semibold">Unrecognized rack code.</p>
        <p className="mt-1 text-amber-700">
          The link <span className="font-mono">{code}</span> doesn't match the rack
          label format. Scan again or pick a rack from the printer below.
        </p>
        <button
          type="button"
          onClick={back}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-white px-3 py-1.5 text-label font-semibold text-amber-800 hover:bg-amber-100"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back to rack printer
        </button>
      </div>
    );
  }

  // `LocationSegments` types numeric fields as `number | string` to keep
  // print-side helpers permissive — `parseLocationCodeFlat` always returns
  // numbers, but TS needs the explicit narrowing here.
  const focusedLevel = Number(segments.level);
  const focusedPositions = byLevel.get(focusedLevel) ?? [];
  const dashedCode = `${segments.zone}-${pad2(segments.aisle)}-${pad2(segments.bay)}-${noPad(focusedLevel)}`;
  const otherLevels = Array.from(byLevel.keys())
    .filter((lv) => lv !== focusedLevel)
    .sort((a, b) => b - a); // top-down physical order (higher levels first)

  return (
    <div className="flex flex-col gap-4 pb-24">
      {/* Responsive shell — sticky/full-bleed on mobile, floating rounded card
          on desktop. The custom className fully replaces the PaneHeader default
          shell (via tailwind-merge) to preserve that responsive behavior. */}
      <PaneHeader
        className="sticky top-0 z-10 -mx-4 border-0 bg-white/95 backdrop-blur sm:mx-0 sm:rounded-2xl sm:shadow-sm sm:ring-1 sm:ring-gray-200/60"
        leftSlot={
          <>
            <button
              type="button"
              onClick={back}
              aria-label="Back to rack printer"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-50 active:scale-95"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="font-mono text-base font-black leading-none tracking-tight text-gray-900">
              {dashedCode}
            </p>
          </>
        }
        rightSlot={<ViewToggle mode={mode} onChange={setMode} />}
        belowSlot={
          <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 px-3 py-2 sm:px-5">
            {roomName && <PaneHeaderStatusPill tone="neutral">{roomName}</PaneHeaderStatusPill>}
            <PaneHeaderStatusPill tone="neutral">Aisle {pad2(segments.aisle)}</PaneHeaderStatusPill>
            <PaneHeaderStatusPill tone="neutral">Bay {pad2(segments.bay)}</PaneHeaderStatusPill>
            <PaneHeaderStatusPill tone={bayHand(segments.bay) === 'Left' ? 'blue' : 'purple'}>
              {bayHand(segments.bay)}
            </PaneHeaderStatusPill>
            <PaneHeaderStatusPill tone="blue">Level {noPad(focusedLevel)}</PaneHeaderStatusPill>
          </div>
        }
      />

      {/* ─── Body ──────────────────────────────────────────────────── */}
      {mode === 'face' ? (
        <RackFace
          loading={loading}
          positions={focusedPositions}
          level={focusedLevel}
          onCellClick={setFlyoutRow}
        />
      ) : (
        <RackList
          loading={loading}
          positions={focusedPositions}
          onRowClick={setFlyoutRow}
        />
      )}

      {/* ─── Neighbor levels expander ──────────────────────────────── */}
      {otherLevels.length > 0 && mode === 'face' && (
        <div className="rounded-2xl border border-gray-200 bg-white">
          <button
            type="button"
            onClick={() => setNeighborsOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            aria-expanded={neighborsOpen}
          >
            <div className="flex items-center gap-2.5">
              <Layers className="h-4 w-4 text-gray-500" />
              <div>
                <p className="text-[12.5px] font-semibold text-gray-900">
                  Other levels on this bay
                </p>
                <p className="text-[10.5px] text-gray-500">
                  {otherLevels.length} more level{otherLevels.length === 1 ? '' : 's'} registered
                </p>
              </div>
            </div>
            <ChevronDown
              className={`h-4 w-4 text-gray-400 transition-transform ${neighborsOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {neighborsOpen && (
            <div className="border-t border-gray-100 px-4 py-3">
              <div className="space-y-3">
                {otherLevels.map((lv) => (
                  <NeighborLevel
                    key={lv}
                    level={lv}
                    positions={byLevel.get(lv) ?? []}
                    onCellClick={setFlyoutRow}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Empty hint when nothing on this level ─────────────────── */}
      {!loading && focusedPositions.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-5 text-center">
          <Printer className="mx-auto h-5 w-5 text-gray-300" />
          <p className="mt-2 text-sm font-semibold text-gray-700">
            No positions registered on this level yet.
          </p>
          <p className="mt-1 text-[11.5px] text-gray-500">
            Print bin-level labels from the <span className="font-semibold">Labels</span> tab to
            populate this rack. Bin labels auto-register their location row.
          </p>
        </div>
      )}

      <BinDetailFlyout row={flyoutRow} onClose={() => setFlyoutRow(null)} onDeleted={refetch} />
    </div>
  );
}

// ─── View toggle ─────────────────────────────────────────────────────────

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div
      role="tablist"
      aria-label="View mode"
      className="flex shrink-0 items-center rounded-full bg-gray-100 p-0.5 text-caption font-semibold"
    >
      {(['face', 'list'] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={mode === m}
          onClick={() => onChange(m)}
          className={`rounded-full px-3 py-1.5 transition-colors ${
            mode === m
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {m === 'face' ? 'Face' : 'List'}
        </button>
      ))}
    </div>
  );
}

// ─── Rack face (primary mobile view) ─────────────────────────────────────

interface RackFaceProps {
  loading: boolean;
  positions: BinsOverviewRow[];
  level: number;
  onCellClick: (row: BinsOverviewRow) => void;
}

function RackFace({ loading, positions, level, onCellClick }: RackFaceProps) {
  if (loading) {
    return (
      <div className="flex gap-2 overflow-x-auto rounded-2xl border border-gray-200 bg-white p-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 w-24 shrink-0 animate-pulse rounded-2xl bg-gray-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-micro font-bold uppercase tracking-[0.16em] text-gray-500">
          Level {noPad(level)} · {positions.length} position{positions.length === 1 ? '' : 's'}
        </p>
        <FillLegend />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {positions.map((row) => (
          <PositionCell key={row.id} row={row} onClick={() => onCellClick(row)} />
        ))}
      </div>
    </div>
  );
}

function FillLegend() {
  return (
    <div className="flex items-center gap-1.5 text-eyebrow font-semibold uppercase tracking-wider text-gray-400">
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-gray-200" /> Empty
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-blue-400" /> Stock
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-amber-400" /> Issue
      </span>
    </div>
  );
}

function PositionCell({ row, onClick }: { row: BinsOverviewRow; onClick: () => void }) {
  const pos = (row.col_label || '').split('-')[1] ?? '';
  const fill = Math.max(0, Math.min(100, row.fill_pct ?? 0));
  const hasIssue = row.is_stale || row.has_low_stock || row.is_over_capacity;

  const tone: 'empty' | 'stock' | 'issue' = hasIssue ? 'issue' : row.is_empty ? 'empty' : 'stock';

  const containerClass = {
    empty: 'border-gray-200 bg-gray-50',
    stock: 'border-blue-200 bg-white',
    issue: 'border-amber-300 bg-amber-50/60',
  }[tone];

  const barClass = {
    empty: 'bg-gray-200',
    stock: 'bg-gradient-to-t from-blue-500 to-blue-400',
    issue: 'bg-gradient-to-t from-amber-500 to-amber-400',
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Position ${pos}, ${tone === 'empty' ? 'empty' : tone === 'issue' ? 'has issue' : `${row.sku_count} SKU${row.sku_count === 1 ? '' : 's'}, ${row.total_qty} units`}`}
      className={`relative flex h-28 w-24 shrink-0 flex-col items-stretch overflow-hidden rounded-2xl border text-left transition-all active:scale-[0.97] ${containerClass}`}
    >
      <div className="flex items-start justify-between px-2.5 pt-2">
        <span className="font-mono text-lg font-black tabular-nums leading-none text-gray-900">
          {pos}
        </span>
        {row.is_over_capacity && (
          <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-mini font-bold uppercase tracking-wider text-white">
            !
          </span>
        )}
      </div>

      <div className="mt-1 flex-1 px-2.5">
        {row.is_empty ? (
          <p className="text-micro font-semibold uppercase tracking-wider text-gray-400">
            Empty
          </p>
        ) : (
          <>
            <p className="text-caption font-bold tabular-nums text-gray-900">
              {row.total_qty}
            </p>
            <p className="text-[9.5px] text-gray-500">
              {row.sku_count} SKU{row.sku_count === 1 ? '' : 's'}
            </p>
          </>
        )}
      </div>

      {/* Fill bar at bottom */}
      <div className="mt-1 h-1.5 w-full bg-gray-100">
        <div
          className={`h-full transition-all ${barClass}`}
          style={{ width: `${tone === 'empty' ? 0 : fill || 8}%` }}
        />
      </div>
    </button>
  );
}

// ─── Neighbor level strip ────────────────────────────────────────────────

function NeighborLevel({
  level,
  positions,
  onCellClick,
}: {
  level: number;
  positions: BinsOverviewRow[];
  onCellClick: (row: BinsOverviewRow) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-micro font-bold uppercase tracking-[0.16em] text-gray-500">
        Level {noPad(level)} · {positions.length}
      </p>
      <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {positions.map((row) => (
          <PositionCell key={row.id} row={row} onClick={() => onCellClick(row)} />
        ))}
      </div>
    </div>
  );
}

// ─── List view (power-user / cycle-count mode) ───────────────────────────

function RackList({
  loading,
  positions,
  onRowClick,
}: {
  loading: boolean;
  positions: BinsOverviewRow[];
  onRowClick: (row: BinsOverviewRow) => void;
}) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse border-b border-gray-100 last:border-b-0" />
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      {positions.map((row, i) => {
        const pos = (row.col_label || '').split('-')[1] ?? '';
        const hasIssue = row.is_stale || row.has_low_stock || row.is_over_capacity;
        return (
          <button
            key={row.id}
            type="button"
            onClick={() => onRowClick(row)}
            className={`flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 ${
              i > 0 ? 'border-t border-gray-100' : ''
            }`}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 font-mono text-base font-bold tabular-nums text-gray-900">
              {pos}
            </span>
            <div className="min-w-0 flex-1">
              {row.is_empty ? (
                <p className="text-label font-semibold uppercase tracking-wider text-gray-400">
                  Empty
                </p>
              ) : (
                <>
                  <p className="truncate text-sm font-semibold text-gray-900">
                    {row.total_qty} units · {row.sku_count} SKU{row.sku_count === 1 ? '' : 's'}
                  </p>
                  <p className="mt-0.5 text-[10.5px] text-gray-500">
                    Fill {row.fill_pct == null ? '—' : `${Math.round(row.fill_pct)}%`}
                    {row.last_counted ? ` · counted ${formatAgo(row.last_counted)}` : ''}
                  </p>
                </>
              )}
            </div>
            {hasIssue && (
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-micro font-bold uppercase tracking-wider text-amber-800">
                Issue
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function formatAgo(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ─── Re-export segment type for callers that need it ────────────────────
export type { LocationSegments };
