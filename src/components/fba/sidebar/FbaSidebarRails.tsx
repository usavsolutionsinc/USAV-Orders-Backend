'use client';

import { useEffect, useMemo, useState } from 'react';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { Button } from '@/design-system/primitives';
import { SidebarRailShell } from '@/components/sidebar/SidebarRailShell';
import { FbaActiveShipments } from '@/components/fba/sidebar/FbaActiveShipments';
import { useFbaBoardSelection } from '@/components/fba/hooks/useFbaBoardSelection';
import { FBA_STATUS_LABEL } from '@/lib/fba/status';
import { FBA_BOARD_SELECT_BY_FNSKU, FBA_COMBINE_STARTED } from '@/lib/fba/events';
import type { StationTheme } from '@/utils/staff-colors';

/* ── Item row (planned / tested / packed) ─────────────────────────────── */

interface FbaItemRow {
  item_id: number;
  fnsku: string;
  display_title: string;
  expected_qty: number;
  actual_qty: number;
  item_status: string;
  shipment_ref: string;
}

const ITEM_DOT: Record<string, string> = {
  PLANNED: 'bg-amber-400',
  TESTED: 'bg-emerald-500',
  PACKED: 'bg-blue-500',
  LABEL_ASSIGNED: 'bg-indigo-500',
};

function FbaItemRail({ statuses, eyebrowTitle }: { statuses: string[]; eyebrowTitle: string }) {
  // Items currently selected on the board → pulsing dot so the user sees this
  // row is already added and being combined.
  const selection = useFbaBoardSelection({ includePairedSelection: true });
  const selectedIds = useMemo(() => new Set(selection.map((i) => i.item_id)), [selection]);
  return (
    <SidebarRailShell<FbaItemRow>
      queryKey={['fba-item-rail', statuses.join(',')]}
      fetchFn={async () => {
        const res = await fetch('/api/fba/board', { cache: 'no-store' });
        const data = await res.json().catch(() => null);
        const pending: FbaItemRow[] = Array.isArray(data?.pending) ? data.pending : [];
        const set = new Set(statuses);
        return pending.filter((r) => set.has(String(r.item_status)));
      }}
      refreshEvents={['usav-refresh-data', 'fba-print-shipped', 'fba-plan-created']}
      selectedId={null}
      eyebrowTitle={eyebrowTitle}
      emptyText="Nothing here yet."
      getId={(r) => r.item_id}
      getStatusDot={(r) =>
        selectedIds.has(r.item_id)
          ? 'bg-blue-500 ring-2 ring-blue-300/70 animate-pulse'
          : ITEM_DOT[String(r.item_status)] ?? 'bg-surface-strong'}
      onSelect={(r) => window.dispatchEvent(new CustomEvent(FBA_BOARD_SELECT_BY_FNSKU, { detail: r.fnsku }))}
      renderRowMain={(r) => (
        <>
          {/* ds-allow-title: truncation-only fallback on a non-interactive clipped <p> */}
          <p className="truncate text-caption font-bold text-text-default" title={r.display_title}>
            {r.display_title || r.fnsku}
          </p>
          <p className="truncate text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
            {r.actual_qty}/{r.expected_qty} units · {FBA_STATUS_LABEL[r.item_status] ?? r.item_status}
          </p>
        </>
      )}
      renderPopover={(r, { openWorkspace }) => (
        <div className="space-y-2 p-3.5">
          <p className="text-sm font-black leading-snug text-text-default">{r.display_title || r.fnsku}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-purple-700">
              {FBA_STATUS_LABEL[r.item_status] ?? r.item_status}
            </span>
            <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-text-muted tabular-nums">
              {r.actual_qty}/{r.expected_qty} units
            </span>
          </div>
          <dl className="space-y-1 border-t border-border-hairline pt-2 text-caption">
            <div className="flex justify-between gap-3"><dt className="font-semibold text-text-soft">FNSKU</dt><dd className="font-mono font-black text-text-default">{r.fnsku}</dd></div>
            {r.shipment_ref ? <div className="flex justify-between gap-3"><dt className="font-semibold text-text-soft">Plan</dt><dd className="font-black text-text-default">{r.shipment_ref}</dd></div> : null}
          </dl>
          <Button variant="primary" size="sm" onClick={openWorkspace} className="w-full">
            Find on board →
          </Button>
        </div>
      )}
    />
  );
}

/* ── Public: pill-headed rail sections for the Plan / Combine sidebars ── */

const PLAN_PILLS: HorizontalSliderItem[] = [
  { id: 'planned', label: 'Planned' },
  { id: 'tested', label: 'Testing' },
];

export type FbaPlanRailView = 'planned' | 'tested';

export function FbaPlanRailPills({
  view,
  onViewChange,
}: {
  view: FbaPlanRailView;
  onViewChange: (view: FbaPlanRailView) => void;
}) {
  return (
    <HorizontalButtonSlider
      items={PLAN_PILLS}
      value={view}
      onChange={(v) => onViewChange(v as FbaPlanRailView)}
      variant="nav"
      dense
      className="w-full"
      aria-label="Plan view"
    />
  );
}

export function FbaPlanRailBody({ view }: { view: FbaPlanRailView }) {
  return view === 'planned' ? (
    <FbaItemRail statuses={['PLANNED']} eyebrowTitle="Planned" />
  ) : (
    <FbaItemRail statuses={['TESTED']} eyebrowTitle="Tested" />
  );
}

export function FbaPlanRail() {
  const [view, setView] = useState<FbaPlanRailView>('planned');
  return (
    <div>
      <FbaPlanRailPills view={view} onViewChange={setView} />
      <FbaPlanRailBody view={view} />
    </div>
  );
}

const COMBINE_PILLS: HorizontalSliderItem[] = [
  { id: 'recent', label: 'Recent' },
  { id: 'packed', label: 'Packed' },
];

export type FbaCombineRailView = 'recent' | 'packed';

export function FbaCombineRailPills({
  view,
  onViewChange,
}: {
  view: FbaCombineRailView;
  onViewChange: (view: FbaCombineRailView) => void;
}) {
  return (
    <HorizontalButtonSlider
      items={COMBINE_PILLS}
      value={view}
      onChange={(v) => onViewChange(v as FbaCombineRailView)}
      variant="nav"
      dense
      className="w-full"
      aria-label="Combine view"
    />
  );
}

export function FbaCombineRailBody({
  view,
  stationTheme = 'green',
}: {
  view: FbaCombineRailView;
  stationTheme?: StationTheme;
}) {
  return view === 'recent' ? (
    <FbaActiveShipments stationTheme={stationTheme} />
  ) : (
    <FbaItemRail statuses={['PACKED']} eyebrowTitle="Packed" />
  );
}

export function FbaCombineRail({ stationTheme = 'green' }: { stationTheme?: StationTheme }) {
  const [view, setView] = useState<FbaCombineRailView>('recent');
  // Pressing "Combine items" on the board flips this rail to Packed so more
  // packed items are easy to select and add to the in-progress combine.
  useEffect(() => {
    const handler = () => setView('packed');
    window.addEventListener(FBA_COMBINE_STARTED, handler);
    return () => window.removeEventListener(FBA_COMBINE_STARTED, handler);
  }, []);
  return (
    <div>
      <FbaCombineRailPills view={view} onViewChange={setView} />
      <FbaCombineRailBody view={view} stationTheme={stationTheme} />
    </div>
  );
}
