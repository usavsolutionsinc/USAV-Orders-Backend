'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import ReceivingLinesTable, { RECEIVING_SELECTION_SCOPE } from './station/ReceivingLinesTable';
import { usePageSelection } from '@/hooks/usePageHeader';
import { useTableSelection } from '@/hooks/useTableSelection';
import { emitToggleAll } from '@/lib/selection/table-selection';
import { ContextualSelectionBar } from '@/design-system/components/ContextualSelectionBar';
import { RightPaneOverlayHost } from '@/components/ui/RightPaneOverlay';
import type { SelectionAction } from '@/lib/selection/selection-actions';
import { ReceivingClaimModal } from './receiving/workspace/ReceivingClaimModal';
import { printProductLabel, printProductLabels } from '@/lib/print/printProductLabel';
import { Barcode, Copy, Printer, MessageSquare, User, Smartphone } from '@/components/Icons';
import { EmptyState } from '@/design-system/primitives';
import { toast } from '@/lib/toast';
import { LocalPickupEditPanel } from './work-orders/LocalPickupEditPanel';
import { LocalPickupReviewPanel } from './work-orders/LocalPickupReviewPanel';
import { ReceivingLineWorkspace } from './receiving/workspace/ReceivingLineWorkspace';
import { ReceivingScanLoader } from './receiving/workspace/ReceivingScanLoader';
import { ReceivingDetailsStack, type ReceivingDetailsLog } from './station/ReceivingDetailsStack';
import {
  fetchReceivingDetailsEnrich,
  receivingDetailsInstantSeed,
} from '@/lib/receiving/receiving-details-overlay';
import type { ReceivingDetailsOverlayDetail } from '@/utils/events';
import { IncomingDetailsPanel } from './sidebar/receiving/IncomingDetailsPanel';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import { useRealtimeToasts } from '@/hooks/useRealtimeToasts';
import { useAuth } from '@/contexts/AuthContext';
import {
  dispatchReceivingWorkspaceClose,
  dispatchReceivingWorkspaceOpen,
} from '@/utils/events';
import {
  dispatchSelectLine,
  shipmentIdFromDeliveredUnscannedRow,
  type ReceivingLineRow,
} from './station/ReceivingLinesTable';

interface WorkspaceState {
  row: ReceivingLineRow;
  accordionBootstrap: 'default' | 'all';
  scanDriven: boolean;
}

interface NavState {
  currentIndex: number;
  total: number;
  canPrev: boolean;
  canNext: boolean;
}

/**
 * Right-pane empty state per sidebar mode. Keyed by the `?mode=` value so each
 * mode's copy is structurally tied to that mode and can never display in
 * another (triage's "pick from the Unfound/Prioritize list" prompt is
 * meaningless in Unbox, and vice versa). Modes without an entry (history /
 * incoming are table-only; pickup early-returns) render no empty state.
 */
const RECEIVING_EMPTY_STATE: Partial<Record<string, { title: string; description: string }>> = {
  triage: {
    title: 'No carton selected',
    description:
      'Pick a carton from the Unfound or Prioritize list, or scan a tracking number to triage it.',
  },
  receive: {
    title: 'Scan to start',
    description: 'Scan a tracking number or pick a carton from the rail to open its PO here.',
  },
};

/**
 * Right-pane renderer for `/receiving`. Headerless — driven entirely by the
 * sidebar's mode pills (`?mode=receive|pickup`) + selection state.
 *
 *   ?mode=pickup            → LocalPickupEditPanel (staged-item editor)
 *   workspace open          → ReceivingLineWorkspace (focused line editor)
 *   no selection, receive   → ReceivingLinesTable (history)
 *
 * The workspace crossfades over the table when a line is selected and back
 * to the table when it closes — same pattern the `/tech` page uses.
 */
export default function ReceivingDashboard() {
  useRealtimeInvalidation({ receiving: true });
  useRealtimeToasts('receiving');
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode') ?? 'receive';
  const isPickupMode = mode === 'pickup';
  const isTriageMode = mode === 'triage';
  // History + Incoming both force the table view (hide the workspace
  // overlay) regardless of whether a workspace happens to be open in
  // component state — switching back to Receiving restores the
  // workspace, so unfinished edits survive a quick peek at either tab.
  const isHistoryMode = mode === 'history';
  const isIncomingMode = mode === 'incoming';
  const isTableOnlyMode = isHistoryMode || isIncomingMode;
  const prefersReducedMotion = useReducedMotion();
  const { user } = useAuth();
  const staffId = String(user?.staffId ?? '');

  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [nav, setNav] = useState<NavState | null>(null);
  const [overlayLog, setOverlayLog] = useState<ReceivingDetailsLog | null>(null);
  // A finalized local pickup PO opens its own review/reprint panel instead of
  // the generic carton details stack (it has no receiving_lines).
  const [pickupReviewOrderId, setPickupReviewOrderId] = useState<number | null>(null);
  const overlayLogIdRef = useRef<string | null>(null);
  useEffect(() => {
    overlayLogIdRef.current = overlayLog?.id ?? null;
  }, [overlayLog?.id]);

  const enrichOverlayLog = useCallback(async (receivingId: number) => {
    try {
      const result = await fetchReceivingDetailsEnrich(receivingId);
      if (overlayLogIdRef.current !== String(receivingId)) return;

      if (result.kind === 'local_pickup') {
        setOverlayLog(null);
        setPickupReviewOrderId(result.orderId);
        return;
      }
      if (result.kind === 'missing') return;

      setPickupReviewOrderId(null);
      setOverlayLog((prev) =>
        prev?.id === String(receivingId) ? { ...prev, ...result.log } : prev,
      );
    } catch {
      // Keep the instant seed visible when enrichment fails.
    }
  }, []);
  // Incoming-mode details panel — populated when a row is selected in
  // mode=incoming. Stored as {po_id, po_number} so the panel can render its
  // header label immediately, then re-key its details query on po_id change.
  const [incomingDetails, setIncomingDetails] = useState<
    { poId: string | null; poNumber: string | null; shipmentId: number | null } | null
  >(null);
  // Scan-in-flight loader state. Populated by 'receiving-scan-in-flight' and
  // cleared 500ms after 'receiving-scan-resolved' to give the workspace open
  // animation a moment to land (avoids a flash of the empty state).
  const [scanInFlight, setScanInFlight] = useState<
    { tracking: string; startedAt: number } | null
  >(null);

  // ── Bulk select (History / Incoming list) ──────────────────────────────────
  // The table list is only visible in table-only modes; selection lives there.
  const [selectMode, setSelectMode] = useState(false);
  const selectedRows = useTableSelection<ReceivingLineRow>(
    RECEIVING_SELECTION_SCOPE,
    (r) => r.id,
  );
  // Single-line claim modal opened from the bulk bar's "Create support ticket".
  const [claimRow, setClaimRow] = useState<ReceivingLineRow | null>(null);

  // Leaving the list (back to the receive workspace / pickup) exits select mode.
  useEffect(() => {
    if (!isTableOnlyMode && selectMode) setSelectMode(false);
  }, [isTableOnlyMode, selectMode]);

  const exitSelectMode = useCallback(() => {
    emitToggleAll(RECEIVING_SELECTION_SCOPE, 'none');
    setSelectMode(false);
  }, []);

  const handleCopyDetails = useCallback((rows: ReceivingLineRow[]) => {
    const text = rows
      .map((r) => {
        const po = (r.zoho_purchaseorder_number || r.zoho_purchaseorder_id || '').trim();
        const sku = (r.sku || '').trim();
        const tracking = (r.tracking_number || '').trim();
        return [po && `PO ${po}`, sku && `SKU ${sku}`, tracking && `TRK ${tracking}`]
          .filter(Boolean)
          .join(' • ');
      })
      .filter(Boolean)
      .join('\n');
    void navigator.clipboard?.writeText(text).then(
      () => toast.success(`Copied ${rows.length} line${rows.length === 1 ? '' : 's'}`),
      () => toast.error('Copy failed'),
    );
  }, []);

  // Print one product label per selected line — serial-level when serials are
  // loaded on the row, else a single SKU label. Reuses the same print pipeline
  // as the workspace's Pass + Print.
  const handlePrintLabels = useCallback((rows: ReceivingLineRow[]) => {
    let printed = 0;
    for (const r of rows) {
      const sku = (r.sku || '').trim();
      if (!sku) continue;
      const serials = (r.serials ?? [])
        .map((s) => (s.serial_number || '').trim())
        .filter(Boolean);
      if (serials.length > 0) {
        printProductLabels({ sku, serialNumbers: serials });
        printed += serials.length;
      } else {
        printProductLabel({ sku });
        printed += 1;
      }
    }
    if (printed > 0) toast.success(`Printing ${printed} label${printed === 1 ? '' : 's'}`);
    else toast.error('No SKU on the selected line(s)');
  }, []);

  // Contextual bulk actions for the receiving-history selection. Declared as a
  // SelectionAction[] so the bar derives the CTA + overflow menu + disabled
  // states from the constraints (see ContextualSelectionBar).
  const receivingBulkActions = useMemo<SelectionAction<ReceivingLineRow>[]>(
    () => [
      {
        key: 'copy',
        label: 'Copy details',
        icon: <Copy className="h-4 w-4" />,
        tone: 'blue',
        primary: true,
        run: handleCopyDetails,
      },
      {
        key: 'print',
        label: 'Print labels',
        icon: <Printer className="h-4 w-4" />,
        run: handlePrintLabels,
      },
      {
        key: 'ticket',
        label: 'Create support ticket',
        icon: <MessageSquare className="h-4 w-4" />,
        maxSelected: 1,
        disabledReason: 'Select a single line to file a ticket',
        run: (rows) => {
          if (rows[0]) setClaimRow(rows[0]);
        },
      },
      {
        key: 'staff',
        label: 'Send to staff',
        icon: <User className="h-4 w-4" />,
        enabled: () => false,
        disabledReason: 'Coming next — needs assignment backend',
        run: () => {
          /* disabled until the backend lands */
        },
      },
      {
        key: 'phone',
        label: 'Send to phone',
        icon: <Smartphone className="h-4 w-4" />,
        enabled: () => false,
        disabledReason: 'Coming next — needs phone push channel',
        run: () => {
          /* disabled until the backend lands */
        },
      },
    ],
    [handleCopyDetails, handlePrintLabels],
  );

  // Selection toggle — surfaced as the pencil in the global header's right
  // actions while the list is up. No page title in the header.
  usePageSelection(
    isTableOnlyMode
      ? {
          active: selectMode,
          onToggle: () => (selectMode ? exitSelectMode() : setSelectMode(true)),
        }
      : null,
    [isTableOnlyMode, selectMode, exitSelectMode],
  );

  useEffect(() => {
    const handleOpen = (e: Event) => {
      const detail = (e as CustomEvent<WorkspaceState | null>).detail;
      if (!detail || !detail.row) return;
      setWorkspace(detail);
    };
    const handleClose = () => {
      setWorkspace(null);
      setNav(null);
    };
    const handleUpdate = (e: Event) => {
      const partial = (e as CustomEvent<Partial<ReceivingLineRow> & { id: number }>).detail;
      if (!partial || typeof partial.id !== 'number') return;
      setWorkspace((prev) =>
        prev && prev.row.id === partial.id
          ? { ...prev, row: { ...prev.row, ...partial } as ReceivingLineRow }
          : prev,
      );
    };
    // Scan-loader events: sidebar dispatches in-flight when lookup-po POSTs,
    // resolved when the response lands. We hold the loader briefly after
    // resolve so the workspace open animation (~180ms) covers the swap.
    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    // Grace delay before the full "Opening your PO" takeover mounts. A scan
    // that resolves locally — the item is already in the incoming/mirror
    // state, a deduped re-scan, or an adopted PO with no Zoho round-trip —
    // comes back well under this threshold, so the row flips inline and the
    // loader never flashes. Only a genuine cold Zoho lookup outlives the delay
    // and shows the skeleton. (Standard skeleton-delay pattern: never flash a
    // loader for sub-threshold latencies.)
    const SCAN_LOADER_GRACE_MS = 300;
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    const handleInFlight = (e: Event) => {
      const detail = (e as CustomEvent<{ tracking: string; startedAt: number }>).detail;
      if (!detail?.tracking) return;
      if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
      }
      if (showTimer) clearTimeout(showTimer);
      showTimer = setTimeout(() => {
        setScanInFlight({ tracking: detail.tracking, startedAt: detail.startedAt });
        showTimer = null;
      }, SCAN_LOADER_GRACE_MS);
    };
    const handleResolved = () => {
      // Resolved before the grace delay elapsed → fast/local/deduped lookup;
      // cancel the pending show so the takeover never appears. If it already
      // showed (slow Zoho path), let it linger briefly so the workspace-open
      // animation covers the swap.
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => {
        setScanInFlight(null);
        clearTimer = null;
      }, 500);
    };

    window.addEventListener('receiving-workspace-open', handleOpen);
    window.addEventListener('receiving-workspace-close', handleClose);
    window.addEventListener('receiving-line-updated', handleUpdate);
    window.addEventListener('receiving-scan-in-flight', handleInFlight);
    window.addEventListener('receiving-scan-resolved', handleResolved);
    return () => {
      window.removeEventListener('receiving-workspace-open', handleOpen);
      window.removeEventListener('receiving-workspace-close', handleClose);
      window.removeEventListener('receiving-line-updated', handleUpdate);
      window.removeEventListener('receiving-scan-in-flight', handleInFlight);
      window.removeEventListener('receiving-scan-resolved', handleResolved);
      if (clearTimer) clearTimeout(clearTimer);
      if (showTimer) clearTimeout(showTimer);
    };
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<NavState | null>).detail;
      setNav(detail ?? null);
    };
    window.addEventListener('receiving-workspace-nav-state', handler);
    return () => window.removeEventListener('receiving-workspace-nav-state', handler);
  }, []);

  // Incoming-mode row select → open the IncomingDetailsPanel overlay.
  // Listens on the same `receiving-select-line` event the table dispatches;
  // the mode check gates so a select in Receiving keeps opening the workspace.
  useEffect(() => {
    if (!isIncomingMode) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const row =
        detail && typeof detail === 'object' && 'row' in detail
          ? ((detail as { row: ReceivingLineRow | null }).row)
          : (detail as ReceivingLineRow | null);
      if (!row) {
        setIncomingDetails(null);
        return;
      }
      const poId = (row.zoho_purchaseorder_id || '').trim();
      // A "Delivered · not scanned" box that never resolved to a PO is shipment-
      // anchored (synthetic row, receiving_id null). Recover its shipment id so
      // the panel can still open (shipment-only mode) and offer a hard delete.
      const shipmentId = shipmentIdFromDeliveredUnscannedRow(row);
      if (!poId && shipmentId == null) {
        // Neither a PO nor a shipment-anchored delivered box → nothing the panel
        // can render. Give deterministic feedback instead of a silent dead click.
        const tracking = (row.tracking_number || '').trim();
        toast.info(tracking ? 'Delivered box not linked to a PO yet' : 'No linked PO for this row yet');
        return;
      }
      setIncomingDetails({
        poId: poId || null,
        poNumber: row.zoho_purchaseorder_number ?? null,
        // Prefer the richer PO view when a PO exists; only fall back to the
        // shipment-only view when there's no PO.
        shipmentId: poId ? null : shipmentId,
      });
    };
    window.addEventListener('receiving-select-line', handler);
    return () => window.removeEventListener('receiving-select-line', handler);
  }, [isIncomingMode]);

  // Mode flip → close any open incoming panel so it doesn't leak into Receiving.
  useEffect(() => {
    if (!isIncomingMode) setIncomingDetails(null);
  }, [isIncomingMode]);

  // Keep the right pane from ever sitting BLANK in Unbox/Receive mode: open the
  // MOST RECENT unboxing line — the same row the Recent rail (ReceivingRecentRail)
  // auto-selects from its `view=activity` query — whenever nothing is open. The
  // effect re-runs on `workspace` so it covers first mount, a workspace close,
  // and a client-side mode switch back to Unbox (not just the initial mount),
  // which is where the pane was previously left empty.
  //
  // It used to prefer a localStorage `last opened` line, which RACED the rail's
  // most-recent auto-select (both dispatch `dispatchSelectLine`, last write won)
  // and reopened a stale carton. Targeting the most-recent row means BOTH
  // mechanisms resolve to the SAME line, so the outcome is deterministic no
  // matter which fires first. Uses `dispatchSelectLine` (not a bare
  // workspace-open) so the sidebar `selectedLine` + rail highlight stay in sync.
  const workspaceRef = useRef<WorkspaceState | null>(null);
  workspaceRef.current = workspace;
  // Guards the "never blank" effect while a delete-recovery (recoverRightPane)
  // is choosing the next line, so the two don't race and momentarily reopen the
  // just-deleted line.
  const recoveringRef = useRef(false);
  useEffect(() => {
    const liveMode = searchParams.get('mode') ?? 'receive';
    if (liveMode !== 'receive') return;
    // Already showing a line, or a delete-recovery owns the next pick — skip.
    if (workspace || recoveringRef.current) return;

    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(
          // sort MUST match ReceivingRecentRail's axis (unboxed_newest) so
          // this effect and the rail's auto-select resolve to the SAME "most
          // recent" line — the default activity sort is door-scan based and
          // picked a different row, so the workspace and the rail highlight
          // disagreed on mode open.
          `/api/receiving-lines?limit=1&offset=0&view=activity&include=serials&sort=unboxed_newest`,
          { cache: 'no-store' },
        );
        const data = await res.json().catch(() => null);
        // Re-check after the await: the rail's auto-select (or an operator click)
        // may have already opened a workspace — never clobber it.
        if (cancelled || workspaceRef.current || recoveringRef.current) return;
        const rows = Array.isArray(data?.receiving_lines)
          ? (data.receiving_lines as ReceivingLineRow[])
          : [];
        const recent = rows[0] ?? null;
        if (recent) dispatchSelectLine(recent);
      } catch {
        /* network blip — the rail's auto-select still covers the common case */
      }
    })();

    return () => {
      cancelled = true;
    };
    // `workspace` in deps: re-run whenever the right pane goes empty (mount,
    // workspace close, or a mode switch back to Unbox) so it is never left blank
    // when there is a most-recent line to show.
  }, [searchParams, workspace]);

  // Recover the right pane after the line it's showing is removed — either the
  // single line itself, or the whole carton (receiving log) it belongs to. The
  // sidebar closes the workspace when its own `selectedLine` matches, but the
  // right pane owns its `workspace` state and can outlive that match, so recover
  // authoritatively here. In Receive mode, drop straight onto the most-recent
  // remaining activity line (the same line the Recent rail auto-selects),
  // skipping anything just deleted; otherwise fall back to an empty pane.
  const recoverRightPane = useCallback(
    (isDeleted: (row: ReceivingLineRow) => boolean) => {
      // Own the next pick so the "never blank" effect doesn't race us and
      // reopen the just-deleted line while we look up its replacement.
      recoveringRef.current = true;
      // Clear immediately so the dead line can't linger during the lookup.
      setWorkspace(null);
      setNav(null);
      if ((searchParams.get('mode') ?? 'receive') !== 'receive') {
        recoveringRef.current = false;
        dispatchReceivingWorkspaceClose();
        return;
      }
      void (async () => {
        try {
          const res = await fetch(
            `/api/receiving-lines?limit=5&offset=0&view=activity&include=serials&sort=unboxed_newest`,
            { cache: 'no-store' },
          );
          const data = await res.json().catch(() => null);
          const rows = Array.isArray(data?.receiving_lines)
            ? (data.receiving_lines as ReceivingLineRow[])
            : [];
          // Guard against an eventually-consistent read still returning the
          // just-deleted line/carton — never re-open something we removed.
          const next = rows.find((r) => !isDeleted(r)) ?? null;
          if (workspaceRef.current) return; // operator already moved on
          if (next) dispatchSelectLine(next);
          else dispatchReceivingWorkspaceClose();
        } catch {
          dispatchReceivingWorkspaceClose();
        } finally {
          recoveringRef.current = false;
        }
      })();
    },
    [searchParams],
  );

  // Single line removed (e.g. last item pulled from an unmatched carton).
  useEffect(() => {
    const handler = (e: Event) => {
      const deletedId = (e as CustomEvent<{ id?: number }>).detail?.id;
      if (typeof deletedId !== 'number') return;
      if (workspaceRef.current?.row.id !== deletedId) return;
      recoverRightPane((r) => r.id === deletedId);
    };
    window.addEventListener('receiving-line-deleted', handler);
    return () => window.removeEventListener('receiving-line-deleted', handler);
  }, [recoverRightPane]);

  // Whole carton (receiving log) removed via the detail panel — `DELETE
  // /api/receiving-logs`. Carries the carton id as a bare-number detail. If the
  // line on screen belongs to that carton, jump to the most-recent survivor.
  useEffect(() => {
    const handler = (e: Event) => {
      const cartonId = Number((e as CustomEvent<unknown>).detail);
      if (!Number.isFinite(cartonId)) return;
      if (workspaceRef.current?.row.receiving_id !== cartonId) return;
      recoverRightPane((r) => r.receiving_id === cartonId);
    };
    window.addEventListener('receiving-entry-deleted', handler);
    return () => window.removeEventListener('receiving-entry-deleted', handler);
  }, [recoverRightPane]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ReceivingDetailsOverlayDetail>).detail;
      const receivingId = Number(detail?.receivingId);
      if (!Number.isFinite(receivingId) || receivingId <= 0) return;

      setPickupReviewOrderId(null);
      setOverlayLog(receivingDetailsInstantSeed(receivingId, detail?.seed));
      void enrichOverlayLog(receivingId);
    };
    window.addEventListener('receiving-open-details-overlay', handler);
    return () => window.removeEventListener('receiving-open-details-overlay', handler);
  }, [enrichOverlayLog]);

  if (isPickupMode) {
    return (
      <div className="flex h-full w-full overflow-hidden bg-[linear-gradient(180deg,#f8fbfb_0%,#ffffff_16%)]">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <LocalPickupEditPanel />
        </div>
      </div>
    );
  }

  // Triage (label "Receiving") deliberately shares the SAME right pane as Unbox:
  // the selected Found/Unfound carton opens in the full ReceivingLineWorkspace /
  // LineEditPanel (matched → PoLinesAccordion, unmatched → UnmatchedItemsSection),
  // so identifying a carton before unboxing uses the exact same editor. It is
  // NOT table-only, so it falls through to the workspace-overlay path below.

  // Surface routing (table stays mounted so its data + scroll survive a
  // tab flip; visibility is toggled via display:none):
  //   - Receiving + workspace → workspace overlay (over the hidden table)
  //   - Receiving + no work   → "Scan to start" prompt
  //   - History               → recent-scans table visible; a tracking/PO
  //                             match opens ReceivingDetailsStack as a
  //                             right-side overlay (below).
  const showWorkspace = !!workspace && !isTableOnlyMode;
  // Scan loader covers the gap between the operator's scan and the PO/line
  // mounting. It must show on EVERY tracking scan — not just a cold start —
  // because the dashboard restores the last opened line from localStorage, so
  // a workspace is almost always already mounted. Gating on `!workspace` (the
  // old behaviour) suppressed the loader for every scan after the first, which
  // left only the scan-bar spinner. The loader is rendered above the workspace
  // (z-20) so it overlays the previously-open line while the new PO resolves.
  const showScanLoader = !!scanInFlight && !isTableOnlyMode;

  return (
    <div className="flex h-full w-full overflow-hidden bg-[linear-gradient(180deg,#f8fbfb_0%,#ffffff_16%)]">
      {/* Right-pane overlay host: anchors RightPaneOverlay surfaces (audit log,
          NAS picker, detail slide-overs) to THIS column so their dim + panel
          stay scoped to the right pane instead of the whole viewport. */}
      <RightPaneOverlayHost className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* History list — always mounted to keep its react-query cache, the
            in-progress search results from a History scan, and its scroll
            position alive across tab flips. Hidden (not unmounted) when the
            operator is in Receiving so the auto-select / first-mount effects
            don't re-fire on every close. */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ display: isTableOnlyMode ? 'block' : 'none' }}
          aria-hidden={!isTableOnlyMode}
        >
          <ReceivingLinesTable selectMode={selectMode} />
        </div>

        {/* Empty right pane — per-mode copy from RECEIVING_EMPTY_STATE (keyed
            by ?mode=). Sits under the workspace/loader overlays (no z), so it
            only shows when neither is mounted. */}
        {!isTableOnlyMode && !showWorkspace && !showScanLoader && RECEIVING_EMPTY_STATE[mode] ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <EmptyState
              icon={<Barcode className="h-7 w-7 text-gray-400" />}
              title={RECEIVING_EMPTY_STATE[mode]!.title}
              description={RECEIVING_EMPTY_STATE[mode]!.description}
            />
          </div>
        ) : null}

        {/* Scan-in-flight skeleton loader. Shown the moment the operator
            submits a tracking scan; cleared 500ms after the response lands. */}
        {showScanLoader ? (
          // When a line workspace is already mounted behind the loader, start
          // it BELOW that workspace's 80px header chrome (40px progress stepper
          // + 40px utility toolbar) so those header rows stay visible and the
          // loader reads as a clean white body panel rather than a translucent
          // overlay covering the whole pane. With no workspace behind (cold
          // start), fill the pane from the top.
          <div
            className={`absolute inset-x-0 bottom-0 z-20 overflow-hidden ${
              showWorkspace ? 'top-[80px]' : 'top-0'
            }`}
          >
            <ReceivingScanLoader
              tracking={scanInFlight!.tracking}
              startedAt={scanInFlight!.startedAt}
            />
          </div>
        ) : null}

        {/* Workspace — overlays everything when a line is active in
            Receiving. Same pattern Linear/Front use: peek the detail over
            the persistent list rather than evicting it. */}
        <AnimatePresence initial={false}>
          {showWorkspace ? (
            <motion.div
              key={`workspace-${workspace!.row.id}`}
              initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0 z-10"
            >
              <ReceivingLineWorkspace
                row={workspace!.row}
                staffId={staffId}
                accordionBootstrap={workspace!.accordionBootstrap}
                scanDriven={workspace!.scanDriven}
                nav={nav}
                variant={isTriageMode ? 'triage' : 'unbox'}
                onPrev={() => {
                  window.dispatchEvent(
                    new CustomEvent('receiving-navigate-table', { detail: 'prev' }),
                  );
                }}
                onNext={() => {
                  window.dispatchEvent(
                    new CustomEvent('receiving-navigate-table', { detail: 'next' }),
                  );
                }}
                onClose={() => {
                  setWorkspace(null);
                  setNav(null);
                  dispatchReceivingWorkspaceClose();
                  window.dispatchEvent(new CustomEvent('receiving-clear-line'));
                  // Triage stays in triage (its rail auto-selects the next top);
                  // Unbox close returns to the History tab as a "back to list".
                  if (!isTriageMode) {
                    const params = new URLSearchParams(searchParams.toString());
                    params.set('mode', 'history');
                    router.replace(`/receiving?${params.toString()}`);
                  }
                }}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* Incoming details panel — right slide-over matching the shipped / FBA
            detail panels (fixed 420px + dimmed backdrop, chrome owned by the
            panel itself). A stable key keeps the panel mounted as rows are
            flipped so only the contents swap. Closing dispatches
            `receiving-clear-line` so the table row deselects. */}
        <AnimatePresence initial={false}>
          {isIncomingMode && incomingDetails ? (
            <IncomingDetailsPanel
              key="incoming-details-panel"
              zohoPurchaseOrderId={incomingDetails.poId}
              poNumberHint={incomingDetails.poNumber}
              shipmentId={incomingDetails.shipmentId}
              onClose={() => {
                setIncomingDetails(null);
                window.dispatchEvent(new CustomEvent('receiving-clear-line'));
              }}
            />
          ) : null}
        </AnimatePresence>

        {/* Bulk-selection action bar — pins to the bottom of the list region
            when rows are selected in History / Incoming. */}
        {isTableOnlyMode ? (
          <ContextualSelectionBar
            scope={RECEIVING_SELECTION_SCOPE}
            rows={selectedRows}
            actions={receivingBulkActions}
          />
        ) : null}
      </RightPaneOverlayHost>

      <AnimatePresence>
        {overlayLog ? (
          <ReceivingDetailsStack
            log={overlayLog}
            onClose={() => setOverlayLog(null)}
            onUpdated={() => void enrichOverlayLog(Number(overlayLog.id))}
            onDeleted={() => setOverlayLog(null)}
          />
        ) : null}
      </AnimatePresence>

      {pickupReviewOrderId != null ? (
        <LocalPickupReviewPanel
          mode="reprint"
          orderId={pickupReviewOrderId}
          onClose={() => setPickupReviewOrderId(null)}
        />
      ) : null}

      {claimRow ? (
        <ReceivingClaimModal
          open
          row={claimRow}
          onClose={() => setClaimRow(null)}
          onTicketCreated={(tk) => {
            toast.success(`Claim filed — ${tk}`);
            setClaimRow(null);
            exitSelectMode();
          }}
        />
      ) : null}
    </div>
  );
}

