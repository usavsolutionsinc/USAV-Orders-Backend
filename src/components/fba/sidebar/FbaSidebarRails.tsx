'use client';

import { useState } from 'react';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { SidebarRailShell } from '@/components/sidebar/SidebarRailShell';
import { FBA_STATUS_LABEL } from '@/lib/fba/status';
import { FBA_BOARD_SELECT_BY_FNSKU, FBA_OPEN_SHIPMENT_EDITOR } from '@/lib/fba/events';
import { fbaPaths } from '@/lib/fba/api-paths';

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
      getStatusDot={(r) => ITEM_DOT[String(r.item_status)] ?? 'bg-gray-300'}
      onSelect={(r) => window.dispatchEvent(new CustomEvent(FBA_BOARD_SELECT_BY_FNSKU, { detail: { fnsku: r.fnsku } }))}
      renderRowMain={(r) => (
        <>
          <p className="truncate text-caption font-bold text-gray-900" title={r.display_title}>
            {r.display_title || r.fnsku}
          </p>
          <p className="truncate text-eyebrow font-semibold uppercase tracking-widest text-gray-500">
            {r.actual_qty}/{r.expected_qty} units · {FBA_STATUS_LABEL[r.item_status] ?? r.item_status}
          </p>
        </>
      )}
      renderPopover={(r, { openWorkspace }) => (
        <div className="space-y-2 p-3.5">
          <p className="text-sm font-black leading-snug text-gray-900">{r.display_title || r.fnsku}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-purple-700">
              {FBA_STATUS_LABEL[r.item_status] ?? r.item_status}
            </span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-gray-600 tabular-nums">
              {r.actual_qty}/{r.expected_qty} units
            </span>
          </div>
          <dl className="space-y-1 border-t border-gray-100 pt-2 text-caption">
            <div className="flex justify-between gap-3"><dt className="font-semibold text-gray-500">FNSKU</dt><dd className="font-mono font-black text-gray-800">{r.fnsku}</dd></div>
            {r.shipment_ref ? <div className="flex justify-between gap-3"><dt className="font-semibold text-gray-500">Plan</dt><dd className="font-black text-gray-800">{r.shipment_ref}</dd></div> : null}
          </dl>
          <button type="button" onClick={openWorkspace} className="w-full rounded-md bg-blue-600 px-2.5 py-1 text-micro font-black uppercase tracking-widest text-white transition-colors hover:bg-blue-700">
            Find on board →
          </button>
        </div>
      )}
    />
  );
}

/* ── Combined shipment row (recently combined) ────────────────────────── */

interface FbaShipmentRow {
  id: number;
  shipment_ref: string;
  amazon_shipment_id: string | null;
  status: string;
  sku_count: number;
  units: number;
  tracking_count: number;
}

function FbaShipmentRail() {
  return (
    <SidebarRailShell<FbaShipmentRow>
      queryKey={['fba-combined-rail']}
      fetchFn={async () => {
        const res = await fetch(fbaPaths.activeWithDetails(), { cache: 'no-store' });
        const data = await res.json().catch(() => null);
        const active: any[] = Array.isArray(data?.active) ? data.active : [];
        return active
          .filter((s) => String(s.status) === 'LABEL_ASSIGNED')
          .map((s) => ({
            id: Number(s.id),
            shipment_ref: String(s.amazon_shipment_id || s.shipment_ref || `#${s.id}`),
            amazon_shipment_id: s.amazon_shipment_id ?? null,
            status: String(s.status),
            sku_count: Number(s.total_items ?? 0),
            units: Number(s.total_actual_qty ?? s.total_expected_qty ?? 0),
            tracking_count: Array.isArray(s.tracking) ? s.tracking.length : 0,
          }));
      }}
      refreshEvents={['usav-refresh-data', 'fba-print-shipped', 'fba-plan-created']}
      selectedId={null}
      eyebrowTitle="Recently Combined"
      emptyText="No combined shipments yet."
      getId={(r) => r.id}
      getStatusDot={() => 'bg-indigo-500'}
      onSelect={(r) => window.dispatchEvent(new CustomEvent(FBA_OPEN_SHIPMENT_EDITOR, { detail: { shipmentId: r.id } }))}
      renderRowMain={(r) => (
        <>
          <p className="truncate text-caption font-black text-gray-900" title={r.shipment_ref}>{r.shipment_ref}</p>
          <p className="truncate text-eyebrow font-semibold uppercase tracking-widest text-gray-500">
            {r.sku_count} SKU · {r.units} units · {r.tracking_count} tracking{r.tracking_count === 1 ? '' : 's'}
          </p>
        </>
      )}
      renderPopover={(r, { openWorkspace }) => (
        <div className="space-y-2 p-3.5">
          <p className="text-sm font-black leading-snug text-gray-900">{r.shipment_ref}</p>
          <span className="inline-block rounded bg-indigo-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-indigo-700">Combined</span>
          <dl className="space-y-1 border-t border-gray-100 pt-2 text-caption">
            <div className="flex justify-between gap-3"><dt className="font-semibold text-gray-500">SKUs</dt><dd className="font-black tabular-nums text-gray-800">{r.sku_count}</dd></div>
            <div className="flex justify-between gap-3"><dt className="font-semibold text-gray-500">Units</dt><dd className="font-black tabular-nums text-gray-800">{r.units}</dd></div>
            <div className="flex justify-between gap-3"><dt className="font-semibold text-gray-500">Trackings</dt><dd className="font-black tabular-nums text-gray-800">{r.tracking_count}</dd></div>
          </dl>
          <button type="button" onClick={openWorkspace} className="w-full rounded-md bg-indigo-600 px-2.5 py-1 text-micro font-black uppercase tracking-widest text-white transition-colors hover:bg-indigo-700">
            Edit shipment →
          </button>
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

export function FbaPlanRail() {
  const [view, setView] = useState<'planned' | 'tested'>('planned');
  return (
    <div>
      <div className="px-3 pt-2">
        <HorizontalButtonSlider items={PLAN_PILLS} value={view} onChange={(v) => setView(v as 'planned' | 'tested')} variant="nav" aria-label="Plan view" />
      </div>
      {view === 'planned'
        ? <FbaItemRail statuses={['PLANNED']} eyebrowTitle="Planned" />
        : <FbaItemRail statuses={['TESTED']} eyebrowTitle="Tested" />}
    </div>
  );
}

const COMBINE_PILLS: HorizontalSliderItem[] = [
  { id: 'recent', label: 'Recent' },
  { id: 'packed', label: 'Packed' },
];

export function FbaCombineRail() {
  const [view, setView] = useState<'recent' | 'packed'>('recent');
  return (
    <div>
      <div className="px-3 pt-2">
        <HorizontalButtonSlider items={COMBINE_PILLS} value={view} onChange={(v) => setView(v as 'recent' | 'packed')} variant="nav" aria-label="Combine view" />
      </div>
      {view === 'recent' ? <FbaShipmentRail /> : <FbaItemRail statuses={['PACKED']} eyebrowTitle="Packed" />}
    </div>
  );
}
