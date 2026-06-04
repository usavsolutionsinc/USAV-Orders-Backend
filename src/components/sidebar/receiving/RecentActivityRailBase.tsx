'use client';

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { getStaffName } from '@/utils/staff';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { Camera } from '@/components/Icons';
import { conditionGradeTableLabel, workflowStatusTableLabel, WORKFLOW_BADGE } from '@/components/station/receiving-constants';
import {
  OrderIdChip, TrackingChip, SkuScanRefChip, SerialChip, getLast4,
} from '@/components/ui/CopyChip';
import { dispatchSelectLine, type ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import {
  SidebarRailShell, railRelativeTime, type SidebarRailRowContext,
} from '@/components/sidebar/SidebarRailShell';

export interface ApiResponse {
  success: boolean;
  receiving_lines: ReceivingLineRow[];
  total: number;
}

export interface RecentActivityRailBaseProps {
  /** Currently selected line id — gets a highlight ring so the rail mirrors the workspace. */
  selectedLineId: number | null;
  /** Full selected row, when available — keeps the active line always present. */
  selectedRow?: ReceivingLineRow | null;
  /** Cap on rendered rows. */
  limit?: number;

  queryKey: ReadonlyArray<unknown>;
  fetchFn: () => Promise<ApiResponse>;
  updateEvent: string;
  /** Optimistic delete event ({ id }); drops the row from the rail immediately. */
  deleteEvent?: string;
  refreshEvents: string[];
  /** prev/next CustomEvent name that steps rail selection — drives header chevrons. */
  navigateEvent?: string;

  eyebrowTitle: string;
  eyebrowSuffix?: string;
  autoSelectFirstWhenEmpty?: boolean;

  getStatusDot: (row: ReceivingLineRow) => string;
  renderQuantity: (row: ReceivingLineRow) => ReactNode;
  previewQtyLabel: string;
  getPreviewQty: (row: ReceivingLineRow) => { current: number; total: number | null };
}

// Stable module-scope callbacks. The shell wires `getId` into its optimistic-
// patch listener effect; passing a fresh arrow each render made that effect
// tear down and re-add its window listener on every parent re-render (a window
// where a `receiving-line-updated` event could be dropped). Hoisting pins the
// identity so the effect subscribes once.
const getRowId = (r: ReceivingLineRow) => r.id;
const getRowGroupId = (r: ReceivingLineRow) => r.receiving_id ?? null;
const getRowActivityAt = (r: ReceivingLineRow) => r.last_activity_at ?? r.created_at;
const selectRow = (r: ReceivingLineRow) => dispatchSelectLine(r);

function canAutoSelectReceivingRailFirst(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('recvId')) return false;
  return (params.get('mode') ?? 'receive') === 'receive';
}

/**
 * Receiving/Testing recent-activity rail. A thin domain wrapper over the
 * generic {@link SidebarRailShell} — it supplies the ReceivingLineRow row body
 * and hover-preview content; the shell owns the skeleton + interactions.
 */
export function RecentActivityRailBase({
  selectedLineId,
  selectedRow = null,
  limit = 25,
  queryKey,
  fetchFn,
  updateEvent,
  deleteEvent,
  refreshEvents,
  navigateEvent,
  eyebrowTitle,
  eyebrowSuffix,
  autoSelectFirstWhenEmpty = false,
  getStatusDot,
  renderQuantity,
  previewQtyLabel,
  getPreviewQty,
}: RecentActivityRailBaseProps) {
  return (
    <SidebarRailShell<ReceivingLineRow>
      queryKey={queryKey}
      fetchFn={async () => (await fetchFn()).receiving_lines ?? []}
      updateEvent={updateEvent}
      deleteEvent={deleteEvent}
      refreshEvents={refreshEvents}
      navigateEvent={navigateEvent}
      selectedId={selectedLineId}
      selectedRow={selectedRow}
      limit={limit}
      eyebrowTitle={eyebrowTitle}
      eyebrowSuffix={eyebrowSuffix}
      autoSelectFirstWhenEmpty={autoSelectFirstWhenEmpty}
      canAutoSelectFirst={
        autoSelectFirstWhenEmpty ? canAutoSelectReceivingRailFirst : undefined
      }
      staggerReveal
      getId={getRowId}
      getGroupId={getRowGroupId}
      getActivityAt={getRowActivityAt}
      onSelect={selectRow}
      getStatusDot={getStatusDot}
      renderRowMain={(row, ctx) => <ReceivingRowMain row={row} ctx={ctx} renderQuantity={renderQuantity} />}
      renderPopover={(row, p) => (
        <ReceivingPopoverContent
          row={row}
          groupSize={p.groupSize}
          qtyLabel={previewQtyLabel}
          getQty={getPreviewQty}
          onOpenWorkspace={() => { p.openWorkspace(); p.dismiss(); }}
        />
      )}
    />
  );
}

function ReceivingRowMain({
  row, ctx, renderQuantity,
}: {
  row: ReceivingLineRow;
  ctx: SidebarRailRowContext;
  renderQuantity: (row: ReceivingLineRow) => ReactNode;
}) {
  const title = row.item_name || row.sku || row.zoho_item_id || `Line #${row.id}`;
  const techId = row.assigned_tech_id ?? null;
  const techColor = techId ? stationThemeColors[getStaffThemeById(techId)].text : 'text-gray-400';

  // Render identical content whether or not the row is selected — selection is
  // a pure ring/background highlight (see SidebarRailShell). Any size/content
  // difference here would change the row's height and shove its neighbors.
  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5">
        <p className="truncate text-caption font-bold text-gray-900" title={title}>{title}</p>
        {ctx.pkgChip}
      </div>
      <p className="truncate text-eyebrow font-semibold uppercase tracking-widest text-gray-500">
        {renderQuantity(row)}
        {techId ? <span className={`ml-1 ${techColor}`}>· {getStaffName(techId)}</span> : null}
      </p>
    </>
  );
}

function ReceivingPopoverContent({
  row, groupSize, qtyLabel, getQty, onOpenWorkspace,
}: {
  row: ReceivingLineRow;
  groupSize: number;
  qtyLabel: string;
  getQty: (row: ReceivingLineRow) => { current: number; total: number | null };
  onOpenWorkspace: () => void;
}) {
  const title = row.item_name || row.sku || row.zoho_item_id || `Line #${row.id}`;
  const { current: qtyCurrent, total: qtyTotal } = getQty(row);
  const isComplete = qtyTotal != null && qtyTotal > 0 && qtyCurrent >= qtyTotal;
  const progressPct =
    qtyTotal != null && qtyTotal > 0 ? Math.min(100, Math.round((qtyCurrent / qtyTotal) * 100)) : qtyCurrent > 0 ? 100 : 0;

  const condGrade = (row.condition_grade || '').trim().toUpperCase();
  const conditionLabel = conditionGradeTableLabel(row.condition_grade);
  const conditionTone =
    condGrade === 'BRAND_NEW' ? 'bg-yellow-50 text-yellow-700 ring-yellow-200'
      : condGrade === 'USED_A' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
        : condGrade === 'USED_B' ? 'bg-blue-50 text-blue-700 ring-blue-200'
          : condGrade === 'USED_C' ? 'bg-slate-100 text-slate-700 ring-slate-300'
            : condGrade === 'PARTS' ? 'bg-amber-50 text-amber-700 ring-amber-200'
              : 'bg-gray-100 text-gray-500 ring-gray-200';

  const workflowLabel = workflowStatusTableLabel(row.workflow_status || 'EXPECTED');
  const workflowTone = WORKFLOW_BADGE[String(row.workflow_status || 'EXPECTED').toUpperCase()] ?? 'bg-gray-100 text-gray-600';

  const trackingValue = (row.tracking_number || '').trim();
  const skuValue = (row.sku || '').trim();
  const poValue = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
  const serialsCsv = (row.serials ?? []).map((s) => (s.serial_number || '').trim()).filter(Boolean).join(', ');

  return (
    <div className="space-y-3 p-3.5">
      <div>
        <div className="flex items-start gap-2">
          <p className="flex-1 text-sm font-black leading-snug text-gray-900">{title}</p>
          {groupSize > 1 ? (
            <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[8.5px] font-black uppercase tracking-widest text-indigo-700">PKG · {groupSize}</span>
          ) : null}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className={`rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest ring-1 ring-inset ${conditionTone}`}>{conditionLabel}</span>
          <span className={`rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest ${workflowTone}`}>{workflowLabel}</span>
          {row.needs_test ? (
            <span className="rounded bg-orange-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-orange-700">Test</span>
          ) : null}
          <span
            className={`ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest ${
              (row.photo_count ?? 0) > 0 ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200' : 'bg-gray-50 text-gray-400 ring-1 ring-inset ring-gray-200'
            }`}
            title={`${row.photo_count ?? 0} ${(row.photo_count ?? 0) === 1 ? 'photo' : 'photos'}`}
          >
            <Camera className="h-3 w-3" />
            {row.photo_count ?? 0}
          </span>
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-eyebrow font-black uppercase tracking-widest text-gray-400">{qtyLabel}</span>
          <span className={`text-caption font-black tabular-nums ${isComplete ? 'text-emerald-600' : 'text-gray-700'}`}>
            {qtyCurrent}<span className="text-gray-300 mx-0.5">/</span><span className="text-gray-400">{qtyTotal ?? '?'}</span>
          </span>
        </div>
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-gray-100">
          <motion.div initial={{ width: 0 }} animate={{ width: `${progressPct}%` }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} className={`h-full ${isComplete ? 'bg-emerald-500' : 'bg-blue-500'}`} />
        </div>
      </div>

      <div className="flex flex-nowrap items-center justify-end gap-1.5 overflow-x-auto border-t border-gray-100 pt-3 [&>*]:shrink-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <OrderIdChip value={poValue} display={getLast4(poValue)} />
        <SkuScanRefChip value={skuValue} display={getLast4(skuValue)} />
        <TrackingChip value={trackingValue} display={getLast4(trackingValue)} />
        {serialsCsv ? <SerialChip value={serialsCsv} /> : null}
      </div>

      <div className="flex items-center justify-between border-t border-gray-100 pt-2.5">
        <span className="text-eyebrow font-bold uppercase tracking-widest text-gray-400">
          {railRelativeTime(row.last_activity_at ?? row.created_at)} ago
          {row.assigned_tech_id ? ` · ${getStaffName(row.assigned_tech_id)}` : ''}
        </span>
        <button
          type="button"
          onClick={onOpenWorkspace}
          className="rounded-md bg-blue-600 px-2.5 py-1 text-micro font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          Open →
        </button>
      </div>
    </div>
  );
}
