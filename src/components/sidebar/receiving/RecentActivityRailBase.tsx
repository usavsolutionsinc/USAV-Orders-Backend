'use client';

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { motionBezier } from '@/design-system/foundations/motion-framer';
import { getStaffName } from '@/utils/staff';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { Camera } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';
import { conditionGradeTableLabel, workflowStatusTableLabel, WORKFLOW_BADGE } from '@/components/station/receiving-constants';
import {
  OrderIdChip, TrackingChip, SkuScanRefChip, SerialChip, getLast4,
} from '@/components/ui/CopyChip';
import { dispatchSelectLine } from '@/components/station/ReceivingLinesTable';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import {
  SidebarRailShell, railRelativeTime, type SidebarRailRowContext,
} from '@/components/sidebar/SidebarRailShell';
import { RailRowBody } from '@/components/sidebar/rail-shell/RailRowBody';

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
  /** Optimistic row pinned at the top until its real row lands (e.g. triage "importing" stub). */
  leadingRow?: ReceivingLineRow | null;
  /** Suppress row clicks while a row is still resolving (e.g. triage importing stub). */
  getRowDisabled?: (row: ReceivingLineRow) => boolean;
  /** Cap on rendered rows. */
  limit?: number;

  queryKey: ReadonlyArray<unknown>;
  fetchFn: () => Promise<ApiResponse>;
  updateEvent: string;
  /** Optimistic delete event ({ id }); drops the row from the rail immediately. */
  deleteEvent?: string;
  /** Optimistic group-delete event (detail = receiving_id); drops the whole carton's rows. */
  deleteGroupEvent?: string;
  refreshEvents: string[];
  /** prev/next CustomEvent name that steps rail selection — drives header chevrons. */
  navigateEvent?: string;

  eyebrowTitle: string;
  eyebrowSuffix?: string;
  /** Right-aligned eyebrow slot (e.g. a refresh button); takes precedence over suffix. */
  eyebrowAction?: ReactNode;
  autoSelectFirstWhenEmpty?: boolean;
  /**
   * Forwarded to the shell. False = strict sort order, no selected-row hoist
   * (the unbox rail sets this so a receive can't bounce a row to the top and
   * back). Defaults to true (preserve the pin) for every other rail.
   */
  pinSelectedLead?: boolean;

  /**
   * Timestamp the row's relative-time label reads. MUST match the feed's sort
   * axis or the rail's times read shuffled (e.g. sorted by unbox activity but
   * labeled with door-scan time). Defaults to last_activity_at → created_at.
   * Pass a module-scope (stable-identity) function — the shell wires it into
   * a listener effect.
   */
  getActivityAt?: (row: ReceivingLineRow) => string | null | undefined;
  getStatusDot: (row: ReceivingLineRow) => string;
  getStatusDotLabel?: (row: ReceivingLineRow) => string;
  renderQuantity: (row: ReceivingLineRow) => ReactNode;
  previewQtyLabel: string;
  getPreviewQty: (row: ReceivingLineRow) => { current: number; total: number | null };
  /**
   * Optional read-only context node rendered inside the hover popover, beneath
   * the badge row (e.g. the unfound triage exception dot + tooltip). Additive —
   * rails that don't pass it render exactly as before.
   */
  renderPopoverContext?: (row: ReceivingLineRow) => ReactNode;
  /**
   * Optional action node rendered in the popover footer, left of "Open →" (e.g.
   * the unfound triage "File claim" button). `dismiss` closes the popover.
   * Additive — unset = today's footer.
   */
  renderPopoverActions?: (row: ReceivingLineRow, ctx: { dismiss: () => void }) => ReactNode;
}

// Stable module-scope callbacks. The shell wires `getId` into its optimistic-
// patch listener effect; passing a fresh arrow each render made that effect
// tear down and re-add its window listener on every parent re-render (a window
// where a `receiving-line-updated` event could be dropped). Hoisting pins the
// identity so the effect subscribes once.
const getRowId = (r: ReceivingLineRow) => r.id;
// Durable render key: an optimistic "importing" stub carries a client_event_id
// that survives its reconcile to the resolved row, so the rail updates the row
// in place (no flicker) instead of remounting on the stub→real id change.
// Server-fetched rows have no client_event_id and fall back to the numeric id.
const getRowReconcileId = (r: ReceivingLineRow): string | number => r.client_event_id ?? r.id;
const getRowGroupId = (r: ReceivingLineRow) => r.receiving_id ?? null;
const getRowActivityAt = (r: ReceivingLineRow) => r.last_activity_at ?? r.created_at;
const selectRow = (r: ReceivingLineRow) => dispatchSelectLine(r);

/** Popover badge tone from the feed-scoped status dot (not raw workflow_status). */
function railStatusBadgeTone(dot: string, fallbackWorkflowStatus: string): string {
  if (dot.includes('emerald')) return 'bg-emerald-100 text-emerald-700';
  if (dot.includes('sky')) return 'bg-sky-100 text-sky-700';
  if (dot.includes('blue')) return 'bg-blue-100 text-blue-700';
  if (dot.includes('indigo')) return 'bg-indigo-100 text-indigo-700';
  if (dot.includes('violet')) return 'bg-violet-100 text-violet-700';
  if (dot.includes('amber')) return 'bg-amber-100 text-amber-700';
  if (dot.includes('teal')) return 'bg-teal-100 text-teal-700';
  if (dot.includes('rose')) return 'bg-rose-100 text-rose-700';
  if (dot.includes('purple')) return 'bg-purple-100 text-purple-700';
  if (dot.includes('slate')) return 'bg-slate-200 text-slate-600';
  return WORKFLOW_BADGE[fallbackWorkflowStatus] ?? 'bg-gray-100 text-gray-600';
}

function canAutoSelectReceivingRailFirst(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('recvId')) return false;
  // Unbox (`receive`, the bare path) and the triage rails (`triage`) auto-select
  // the top of their queue so a mode shows its most-recent item, not an empty
  // background. Each rail only renders in its own mode, so allowing both is safe.
  const m = params.get('mode') ?? 'receive';
  return m === 'receive' || m === 'triage';
}

/**
 * Receiving/Testing recent-activity rail. A thin domain wrapper over the
 * generic {@link SidebarRailShell} — it supplies the ReceivingLineRow row body
 * and hover-preview content; the shell owns the skeleton + interactions.
 */
export function RecentActivityRailBase({
  selectedLineId,
  selectedRow = null,
  leadingRow = null,
  getRowDisabled,
  limit = 25,
  queryKey,
  fetchFn,
  updateEvent,
  deleteEvent,
  deleteGroupEvent,
  refreshEvents,
  navigateEvent,
  eyebrowTitle,
  eyebrowSuffix,
  eyebrowAction,
  autoSelectFirstWhenEmpty = false,
  pinSelectedLead = true,
  getActivityAt = getRowActivityAt,
  getStatusDot,
  getStatusDotLabel,
  renderQuantity,
  previewQtyLabel,
  getPreviewQty,
  renderPopoverContext,
  renderPopoverActions,
}: RecentActivityRailBaseProps) {
  return (
    <SidebarRailShell<ReceivingLineRow>
      queryKey={queryKey}
      fetchFn={async () => (await fetchFn()).receiving_lines ?? []}
      updateEvent={updateEvent}
      deleteEvent={deleteEvent}
      deleteGroupEvent={deleteGroupEvent}
      refreshEvents={refreshEvents}
      navigateEvent={navigateEvent}
      selectedId={selectedLineId}
      selectedRow={selectedRow}
      leadingRow={leadingRow}
      getRowDisabled={getRowDisabled}
      limit={limit}
      pinSelectedLead={pinSelectedLead}
      eyebrowTitle={eyebrowTitle}
      eyebrowSuffix={eyebrowSuffix}
      eyebrowAction={eyebrowAction}
      autoSelectFirstWhenEmpty={autoSelectFirstWhenEmpty}
      canAutoSelectFirst={
        autoSelectFirstWhenEmpty ? canAutoSelectReceivingRailFirst : undefined
      }
      staggerReveal
      getId={getRowId}
      getReconcileId={getRowReconcileId}
      getGroupId={getRowGroupId}
      getActivityAt={getActivityAt}
      onSelect={selectRow}
      getStatusDot={getStatusDot}
      getStatusDotLabel={getStatusDotLabel}
      renderRowMain={(row, ctx) => <ReceivingRowMain row={row} ctx={ctx} renderQuantity={renderQuantity} />}
      renderPopover={(row, p) => (
        <ReceivingPopoverContent
          row={row}
          groupSize={p.groupSize}
          qtyLabel={previewQtyLabel}
          getQty={getPreviewQty}
          activityAt={getActivityAt(row) ?? null}
          statusDot={getStatusDot(row)}
          statusLabel={getStatusDotLabel?.(row) ?? workflowStatusTableLabel(row.workflow_status || 'EXPECTED')}
          onOpenWorkspace={() => { p.openWorkspace(); p.dismiss(); }}
          contextSlot={renderPopoverContext?.(row)}
          actionsSlot={renderPopoverActions?.(row, { dismiss: p.dismiss })}
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
  // Shared row anatomy via `RailRowBody` (`rail` density) — the same primitive
  // the tech Up-Next `OrderCard` renders; only the slot content differs.
  return (
    <RailRowBody
      vm={{
        title,
        titleAttr: title,
        titleAccessory: ctx.pkgChip,
        meta: (
          <span className="block truncate font-semibold uppercase tracking-widest text-gray-500">
            {renderQuantity(row)}
            {techId ? <span className={`ml-1 ${techColor}`}>· {getStaffName(techId)}</span> : null}
          </span>
        ),
      }}
    />
  );
}

function ReceivingPopoverContent({
  row, groupSize, qtyLabel, getQty, activityAt, statusDot, statusLabel, onOpenWorkspace, contextSlot, actionsSlot,
}: {
  row: ReceivingLineRow;
  groupSize: number;
  qtyLabel: string;
  getQty: (row: ReceivingLineRow) => { current: number; total: number | null };
  /** Same timestamp the row's relative-time label shows (the feed's sort axis). */
  activityAt: string | null;
  /** Feed-scoped status dot class — drives the popover badge tone. */
  statusDot: string;
  /** Feed-scoped status label — replaces raw workflow_status in the badge. */
  statusLabel: string;
  onOpenWorkspace: () => void;
  /** Optional read-only context (e.g. unfound exception dot) under the badges. */
  contextSlot?: ReactNode;
  /** Optional footer action (e.g. "File claim"), left of "Open →". */
  actionsSlot?: ReactNode;
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

  const workflowLabel = statusLabel;
  const workflowTone = railStatusBadgeTone(
    statusDot,
    String(row.workflow_status || 'EXPECTED').toUpperCase(),
  );

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
          {/* Unfound cartons have no Zoho PO — their RECEIVED state is local-only
              (no Zoho receive). The "No PO" tag marks that the website↔Zoho gap
              is intentional, not a failed sync. */}
          {row.receiving_source === 'unmatched' ? (
            <HoverTooltip label="No matching Zoho PO — received locally only" asChild>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-slate-500 ring-1 ring-inset ring-slate-200">No PO</span>
            </HoverTooltip>
          ) : null}
          {/* Phase 2: a physically-present box whose Zoho PO already reads
              received/closed stays in the queue (not hidden) with this badge,
              surfacing the physical-vs-financial mismatch instead of vanishing. */}
          {['billed', 'closed', 'cancelled', 'received', 'rejected'].includes(
            String(row.zoho_status || '').toLowerCase(),
          ) ? (
            <HoverTooltip label={`Zoho marks this PO "${row.zoho_status}" — already received/closed upstream, but the box is still here to unbox`} asChild>
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-amber-700 ring-1 ring-inset ring-amber-200">Zoho: {String(row.zoho_status)}</span>
            </HoverTooltip>
          ) : null}
          {row.needs_test ? (
            <span className="rounded bg-orange-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-orange-700">Test</span>
          ) : null}
          <HoverTooltip
            label={`${row.photo_count ?? 0} ${(row.photo_count ?? 0) === 1 ? 'photo' : 'photos'}`}
            asChild
          >
            <span
              className={`ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest ${
                (row.photo_count ?? 0) > 0 ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200' : 'bg-gray-50 text-gray-400 ring-1 ring-inset ring-gray-200'
              }`}
            >
              <Camera className="h-3 w-3" />
              {row.photo_count ?? 0}
            </span>
          </HoverTooltip>
        </div>
      </div>

      {contextSlot ? <div>{contextSlot}</div> : null}

      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-eyebrow font-black uppercase tracking-widest text-gray-400">{qtyLabel}</span>
          <span className={`text-caption font-black tabular-nums ${isComplete ? 'text-emerald-600' : 'text-gray-700'}`}>
            {qtyCurrent}<span className="text-gray-300 mx-0.5">/</span><span className="text-gray-400">{qtyTotal ?? '?'}</span>
          </span>
        </div>
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-gray-100">
          <motion.div initial={{ width: 0 }} animate={{ width: `${progressPct}%` }} transition={{ duration: 0.35, ease: motionBezier.easeOut }} className={`h-full ${isComplete ? 'bg-emerald-500' : 'bg-blue-500'}`} />
        </div>
      </div>

      <div className="flex flex-nowrap items-center justify-between gap-1.5 overflow-x-auto border-t border-gray-100 pt-3 [&>*]:shrink-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <OrderIdChip value={poValue} display={getLast4(poValue)} />
        <SkuScanRefChip value={skuValue} display={getLast4(skuValue)} />
        <TrackingChip value={trackingValue} display={getLast4(trackingValue)} />
        {/* Always render the serial chip — even with no serial it shows the
            `----` placeholder (resolveSerialDisplay) so the column stays put and
            lines up across rows. Content-fit width (not the default w-[84px])
            so the value hugs the right edge of this justify-end row instead of
            leaving dead space to its right. */}
        <SerialChip value={serialsCsv} width="w-fit shrink-0" />
      </div>

      <div className="flex items-center justify-between border-t border-gray-100 pt-2.5">
        <span className="text-eyebrow font-bold uppercase tracking-widest text-gray-400">
          {railRelativeTime(activityAt ?? row.created_at)} ago
          {row.assigned_tech_id ? ` · ${getStaffName(row.assigned_tech_id)}` : ''}
        </span>
        <div className="flex items-center gap-1.5">
          {actionsSlot}
          <Button
            variant="primary"
            size="sm"
            onClick={onOpenWorkspace}
            className="h-auto rounded-md px-2.5 py-1 text-micro font-black uppercase tracking-widest"
          >
            Open →
          </Button>
        </div>
      </div>
    </div>
  );
}
