'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalStorage } from '@/hooks';
import { motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from '@/lib/toast';
import {
  receivingScanBandClass,
  sidebarHeaderBandClass,
  sidebarHeaderPillRowClass,
  SIDEBAR_GUTTER,
} from '@/components/layout/header-shell';
import { cn } from '@/utils/_cn';
import { X, Clock, Layers } from '@/components/Icons';
import { useUIModeOptional } from '@/design-system/providers/UIModeProvider';
import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import {
  ReceivingReturnBanner,
  type ReturnEvent,
} from '@/components/sidebar/ReceivingReturnBanner';
import {
  ReceivingUnboxScanBar,
  classifyUnboxScan,
  type UnboxScanMode,
} from '@/components/sidebar/receiving/ReceivingUnboxScanBar';
import { SearchBar } from '@/components/ui/SearchBar';
import { ReceivingHistorySearchSection } from '@/components/sidebar/receiving/ReceivingHistorySearchSection';
import { ReceivingLinePicker } from '@/components/sidebar/receiving/ReceivingLinePicker';
import { ReceivingRecentRail } from '@/components/sidebar/receiving/ReceivingRecentRail';
import { ReceivingScannedRail } from '@/components/sidebar/receiving/ReceivingScannedRail';
import { TriageSidebarBody } from '@/components/sidebar/receiving/TriageSidebarBody';
import { IncomingSidebarPanel } from '@/components/sidebar/receiving/IncomingSidebarPanel';
import {
  dispatchReceivingWorkspaceOpen,
  dispatchReceivingWorkspaceClose,
  dispatchReceivingWorkspaceNavState,
  dispatchReceivingDetailsOverlay,
} from '@/utils/events';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { useAblyClient } from '@/contexts/AblyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterNavEnabled } from '@/components/sidebar/master-nav';
import { printProductLabel } from '@/lib/print/printProductLabel';
import { LocalPickupSidebarList } from '@/components/work-orders/LocalPickupSidebarList';
import {
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';
import {
  RECEIVING_MODE_ITEMS,
  parseReceivingPackage,
  mapApiLineToPoSummary,
  randomId,
  readSelectLineDetail,
  type ReceivingMode,
  type PoLineSummary,
  type PoContext,
  type ReceivingSelectLineDetail,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';
import { useReceivingLineNavigation } from '@/components/sidebar/receiving/useReceivingLineNavigation';
import { useReceivingSourcePlatform } from '@/components/sidebar/receiving/useReceivingSourcePlatform';
import { clearReceivingHistoryUrlParams } from '@/lib/receiving-history-search';
import { resolveReceivingCodeToLine } from '@/lib/testing/resolve-testing-scan';
import { useStationTheme } from '@/hooks/useStationTheme';


/**
 * Synthesize a ReceivingLineRow for an unmatched carton that has no
 * receiving_lines rows yet (operator just scanned the tracking; no items
 * added). UnfoundLineEditPanel only needs receiving_id + receiving_source
 * to do its work — the rest are placeholders so the row typechecks for
 * the shared workspace event payload.
 *
 * `id` is negated so it can't collide with a real receiving_lines.id when
 * keying motion components downstream.
 */
function buildUnmatchedStubRow(
  receivingId: number,
  trackingNumber: string,
): ReceivingLineRow {
  return {
    id: -receivingId,
    receiving_id: receivingId,
    tracking_number: trackingNumber,
    carrier: null,
    zoho_item_id: null,
    zoho_line_item_id: null,
    zoho_purchase_receive_id: null,
    zoho_purchaseorder_id: null,
    zoho_purchaseorder_number: null,
    item_name: null,
    sku: null,
    quantity_received: 0,
    quantity_expected: null,
    qa_status: 'PENDING',
    workflow_status: null,
    disposition_code: 'HOLD',
    // Leave empty so the workspace stepper's "Condition" step does NOT
    // auto-mark itself done — the DB column defaults to 'BRAND_NEW' but
    // for the synthetic carton stub the operator hasn't actively chosen
    // a grade yet.
    condition_grade: '',
    disposition_audit: [],
    needs_test: true,
    assigned_tech_id: null,
    zoho_sync_source: null,
    zoho_last_modified_time: null,
    zoho_synced_at: null,
    receiving_type: 'PO',
    notes: null,
    created_at: null,
    image_url: null,
    source_platform: null,
    receiving_source: 'unmatched',
  };
}

export function ReceivingSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isMobile } = useUIModeOptional();
  const masterNavEnabled = useMasterNavEnabled();
  const rawMode = searchParams.get('mode');
  const mode: ReceivingMode =
    rawMode === 'pickup'
      ? 'pickup'
      : rawMode === 'history'
        ? 'history'
        : rawMode === 'incoming'
          ? 'incoming'
          : rawMode === 'triage'
            ? 'triage'
            : 'receive';
  // Triage (label "Receiving") shares the scan-bar + recent-rail sidebar body
  // with the Unbox workspace (`receive`); only the right pane differs. Treat the
  // two together wherever the sidebar shows the scan surface.
  const isScanSurface = mode === 'receive' || mode === 'triage';
  // Unbox-mode sub-view toggle (sticky pills at the top of the rail). `recent` =
  // the live unboxing rail (default); `queue` = the same priority-sorted Scanned
  // rail the triage Prioritize tab shows. Lives in the URL per the sidebar-mode
  // contract so a refresh/deep-link keeps it; absence = recent.
  const unboxView: 'recent' | 'queue' =
    searchParams.get('unboxview') === 'queue' ? 'queue' : 'recent';
  // Identity is server-derived. The proxy redirects unauthenticated traffic
  // to /signin, so `user` is non-null whenever this sidebar renders. The
  // optional-chain is a TS-narrowing nicety, not a runtime fallback.
  const { user } = useAuth();
  const staffIdNum = user?.staffId ?? 0;
  const staffId = String(staffIdNum);
  const { theme: themeColor } = useStationTheme({ staffId: staffIdNum });
  // Soft centered halo behind the scan input — staff-tint fades in toward
  // the middle of the band and back to white on the edges, instead of a
  // flat-fill block. Keeps the bar feeling light/airy.
  const bandHaloClass: Record<typeof themeColor, string> = {
    green: 'bg-gradient-to-r from-white via-emerald-50 to-white',
    blue: 'bg-gradient-to-r from-white via-blue-50 to-white',
    purple: 'bg-gradient-to-r from-white via-purple-50 to-white',
    yellow: 'bg-gradient-to-r from-white via-amber-50 to-white',
    black: 'bg-gradient-to-r from-white via-slate-50 to-white',
    red: 'bg-gradient-to-r from-white via-red-50 to-white',
    lightblue: 'bg-gradient-to-r from-white via-sky-50 to-white',
    pink: 'bg-gradient-to-r from-white via-pink-50 to-white',
  };

  // Ably handles are needed both for the existing phone-scan bridge (later in
  // this file) and the new photo-request publisher below. Hoisting the client
  // + channel names up here keeps the publisher's closure honest.
  const { getClient: getAblyClient } = useAblyClient();
  const phoneChannelName = `phone:${staffIdNum}`;
  const stationChannelName = `station:${staffIdNum}`;

  /**
   * Publish a `receiving_photo_request` on `station:{staffId}` so a phone
   * loaded on the same staff id auto-navigates to the photo capture page.
   * Implicit pairing: the channel name is the gate — no claim flow required.
   */
  const publishPhotoRequestFor = useCallback(
    async (receivingId: number, tracking: string) => {
      if (!Number.isFinite(receivingId) || receivingId <= 0 || staffIdNum <= 0) return;
      try {
        const client = await getAblyClient();
        if (!client) return;
        const ch = client.channels.get(stationChannelName);
        await ch.publish('receiving_photo_request', {
          receiving_id: receivingId,
          tracking,
          request_id: randomId(),
          requested_by_staff_id: staffIdNum,
        });
      } catch (err) {
        console.warn('receiving-sidebar: photo request publish failed', err);
      }
    },
    [getAblyClient, staffIdNum, stationChannelName],
  );

  useEffect(() => {
    if (mode === 'pickup') {
      window.dispatchEvent(new CustomEvent('receiving-clear-line'));
    }
    // Returning to a scan surface (Unbox / Receiving-triage) from History /
    // Pickup / Incoming — focus the tracking field (the scan-bar effect above
    // listens for this event).
    if (isScanSurface) {
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('receiving-focus-scan'));
      });
    }
  }, [mode, isScanSurface]);

  const [bulkTracking, setBulkTracking] = useState('');
  // Armed unbox scan route (null = auto-detect: a value with "-" → Order#).
  // Tracking resolves a carrier #, Order# resolves a Zoho PO / reference #.
  const [unboxScanMode, setUnboxScanMode] = useState<UnboxScanMode | null>(null);
  // Desktop triage search — filters the Found/Unfound to-do lists. Triage is a
  // browse/triage surface (a search), NOT a scan surface, so it uses SearchBar
  // instead of the StationScanBar the Unbox workspace uses.
  const [triageQuery, setTriageQuery] = useState('');
  const scanInputRef = useRef<HTMLInputElement>(null);

  // External focus trigger — Quick Access chips (`Search Receiving`,
  // `Receiving`) dispatch `receiving-focus-scan` after navigating so the
  // input is hot even when the panel was already mounted.
  useEffect(() => {
    const handler = () =>
      requestAnimationFrame(() => scanInputRef.current?.focus());
    window.addEventListener('receiving-focus-scan', handler);
    return () => window.removeEventListener('receiving-focus-scan', handler);
  }, []);
  /** Spin the scan-field loader while `/api/receiving/lookup-po` is in flight */
  const [trackingLookupInFlight, setTrackingLookupInFlight] = useState(0);
  const [selectedLine, setSelectedLine] = useState<ReceivingLineRow | null>(null);
  /** `'all'` when the line was chosen from the main table — expands sidebar FlowSections. */
  const [lineAccordionBootstrap, setLineAccordionBootstrap] = useState<'default' | 'all'>(
    'default',
  );
  // `scanDriven` flips the LineEditPanel into compact mode; scans open it,
  // row-clicks open it in full mode. Cleared on close / filter change.
  const [scanDriven, setScanDriven] = useState(false);
  // Full ReceivingLineRow[] fetched after a tracking scan matches multiple
  // lines — rendered as a picker above LineEditPanel until one is chosen.
  const [scanMatchedRows, setScanMatchedRows] = useState<ReceivingLineRow[]>([]);

  // ─── Unboxing mode state ─────────────────────────────────────────────────
  const [poContext, setPoContext] = useState<PoContext | null>(null);
  const [armedLineId, setArmedLineId] = useState<number | null>(null);
  const [serialInput, setSerialInput] = useState('');
  const [serialSubmitting, setSerialSubmitting] = useState(false);
  const [returns, setReturns] = useState<ReturnEvent[]>([]);
  const [pendingCandidates, setPendingCandidates] = useState<PoLineSummary[]>([]);
  // Read-only setting (no toggle in this panel); persisted format is compatible
  // with the prior hand-rolled 'true'/'false' string.
  const [printOnScan] = useLocalStorage('receiving.printOnScan', true);
  const serialInputRef = useRef<HTMLInputElement>(null);

  const armedLine = useMemo<PoLineSummary | null>(() => {
    if (armedLineId == null || !poContext) return null;
    return poContext.lines.find((l) => l.id === armedLineId) ?? null;
  }, [armedLineId, poContext]);

  const {
    currentIndex,
    canPrev,
    canNext,
    progressReceived,
    progressTotal,
    goPrevLine,
    goNextLine,
  } = useReceivingLineNavigation({
    selectedLine,
    scanMatchedRows,
    setSelectedLine,
    setScanMatchedRows,
    setLineAccordionBootstrap,
  });

  // ── Right-pane workspace bridge ────────────────────────────────────────
  //
  // The line editor moved to `ReceivingLineWorkspace` (mounted by
  // `ReceivingDashboard` in the right pane). Sidebar stays the source of
  // truth for scan flow + line selection; it just dispatches events the
  // workspace listens to.

  // Open / close: dispatch whenever the selected line, scan-driven flag, or
  // bootstrap mode changes. Null clears the workspace pane.
  useEffect(() => {
    if (selectedLine) {
      dispatchReceivingWorkspaceOpen({
        row: selectedLine,
        accordionBootstrap: lineAccordionBootstrap,
        scanDriven,
      });
    } else {
      dispatchReceivingWorkspaceClose();
    }
  }, [selectedLine, lineAccordionBootstrap, scanDriven]);

  // Nav state mirror: workspace header reads prev/next + Line N of M from
  // these events instead of having scanMatchedRows lifted up.
  useEffect(() => {
    if (!selectedLine) return;
    dispatchReceivingWorkspaceNavState({
      currentIndex,
      total: scanMatchedRows.length,
      canPrev,
      canNext,
    });
  }, [selectedLine, currentIndex, scanMatchedRows.length, canPrev, canNext]);

  // Workspace X-button → clear our own state so both panes converge on empty.
  useEffect(() => {
    const handler = () => {
      setSelectedLine(null);
      setLineAccordionBootstrap('default');
      setScanDriven(false);
      setScanMatchedRows([]);
      clearPoContext();
    };
    window.addEventListener('receiving-workspace-close', handler);
    return () => window.removeEventListener('receiving-workspace-close', handler);
  }, []);

  // `receiving-clear-line` is a full deselect signal — fired on mode switch and
  // when the triage Found/Unfound sub-view changes. Clear the panel's selection
  // too (not just the right pane) so the rail highlight resets and the new
  // list/sub-list auto-selects its own top instead of pinning the prior pick.
  useEffect(() => {
    const handler = () => {
      setSelectedLine(null);
      setScanDriven(false);
      setScanMatchedRows([]);
      clearPoContext();
    };
    window.addEventListener('receiving-clear-line', handler);
    return () => window.removeEventListener('receiving-clear-line', handler);
    // clearPoContext is a stable useCallback([]) — matches the workspace-close
    // effect above; referenced in the handler, not synchronously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Line deleted (e.g. last item removed from a carton) → if it was the active
  // line, converge both panes on empty so the Recent rail can't re-pin it from
  // the stale `selectedLine`. Read the id from a ref to avoid re-subscribing on
  // every selection change. The rail also drops the row optimistically via its
  // own `deleteEvent` listener (SidebarRailShell).
  const selectedLineRef = useRef<ReceivingLineRow | null>(selectedLine);
  selectedLineRef.current = selectedLine;
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ id?: number }>).detail?.id;
      if (typeof id !== 'number') return;
      setScanMatchedRows((rows) => rows.filter((r) => r.id !== id));
      if (selectedLineRef.current?.id === id) {
        window.dispatchEvent(new CustomEvent('receiving-workspace-close'));
      }
    };
    window.addEventListener('receiving-line-deleted', handler);
    return () => window.removeEventListener('receiving-line-deleted', handler);
  }, []);

  // Whole carton (receiving log) deleted from the detail panel → if the active
  // line belongs to it, converge both panes on empty so the Recent rail can
  // auto-select the most-recent survivor. `receiving-entry-deleted` carries the
  // carton id as its detail; the rail drops the carton's rows via its own
  // `deleteGroupEvent` listener (SidebarRailShell).
  useEffect(() => {
    const handler = (e: Event) => {
      const cartonId = Number((e as CustomEvent<unknown>).detail);
      if (!Number.isFinite(cartonId)) return;
      setScanMatchedRows((rows) => rows.filter((r) => r.receiving_id !== cartonId));
      if (selectedLineRef.current?.receiving_id === cartonId) {
        window.dispatchEvent(new CustomEvent('receiving-workspace-close'));
      }
    };
    window.addEventListener('receiving-entry-deleted', handler);
    return () => window.removeEventListener('receiving-entry-deleted', handler);
  }, []);

  // History-mode row clicks route through the `receiving-select-line` listener
  // below — they fire `receiving-open-details-overlay` directly instead of
  // touching `selectedLine`, so no mode-bounce effect is needed here.

  useEffect(() => {
    if (mode === 'pickup') {
      setPoContext(null);
      setArmedLineId(null);
      setSerialInput('');
      setReturns([]);
      setPendingCandidates([]);
    }
  }, [mode]);

  // ─── Selected line from table row click ──────────────────────────────────
  // The listener is mounted once and reads `mode` via a ref so it always sees
  // the current pill value — without the ref, a History-mode click captured
  // the original closure and tried to open the workspace.
  const modeRef = useRef<ReceivingMode>(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => {
    const handleSelect = (e: Event) => {
      const { row, expandFlowSections } = readSelectLineDetail(
        (e as CustomEvent<ReceivingSelectLineDetail>).detail,
      );
      // History mode: row click is read-only. Open the existing details
      // overlay (ReceivingDetailsStack) instead of mutating sidebar state.
      // The stack's "Edit PO" CTA is the only path back to the workspace.
      //
      // Read mode from window.location.search (not modeRef) so a mid-flight
      // URL flip — e.g. Edit PO setting ?mode=receive immediately before
      // dispatching select — is honored. The ref lags by a render and
      // would route the operator back into a fresh details stack.
      const liveMode = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('mode')
        : modeRef.current;
      if (liveMode === 'history' && row?.receiving_id != null) {
        dispatchReceivingDetailsOverlay(row.receiving_id);
        return;
      }
      const expand = Boolean(row != null && expandFlowSections);
      setLineAccordionBootstrap(expand ? 'all' : 'default');
      setSelectedLine(row);
      // Row clicks always open the full LineEditPanel (scan-driven → compact).
      setScanDriven(false);
      setScanMatchedRows([]);
    };
    const handleUpdated = (e: Event) => {
      const updated = (e as CustomEvent<Partial<ReceivingLineRow> & { id: number }>).detail;
      if (!updated || typeof updated.id !== 'number') return;
      setSelectedLine((prev) => (prev?.id === updated.id ? { ...prev, ...updated } : prev));
      setScanMatchedRows((rows) =>
        rows.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)),
      );
    };
    const handlePackageMeta = (e: Event) => {
      const detail = (e as CustomEvent<{
        receiving_id?: number;
        support_notes?: string | null;
      }>).detail;
      if (!detail || detail.receiving_id == null || detail.support_notes === undefined) return;
      const rid = detail.receiving_id;
      const sn = detail.support_notes;
      setSelectedLine((prev) =>
        prev?.receiving_id === rid ? { ...prev, receiving_support_notes: sn } : prev,
      );
      setScanMatchedRows((rows) =>
        rows.map((r) => (r.receiving_id === rid ? { ...r, receiving_support_notes: sn } : r)),
      );
    };
    // Mirror selectedLine from workspace-open events so the rail highlights
    // restored lines (localStorage + most-recent fallback in
    // ReceivingDashboard go directly through dispatchReceivingWorkspaceOpen,
    // bypassing handleSelect). Id-compare guards the setState→workspace-open
    // useEffect from looping.
    const handleWorkspaceOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ row?: ReceivingLineRow } | null>)
        .detail;
      const row = detail?.row;
      if (!row || typeof row.id !== 'number') return;
      setSelectedLine((prev) => (prev?.id === row.id ? prev : row));
    };
    window.addEventListener('receiving-select-line', handleSelect);
    window.addEventListener('receiving-line-updated', handleUpdated);
    window.addEventListener('receiving-package-updated', handlePackageMeta);
    window.addEventListener('receiving-workspace-open', handleWorkspaceOpen);
    return () => {
      window.removeEventListener('receiving-select-line', handleSelect);
      window.removeEventListener('receiving-line-updated', handleUpdated);
      window.removeEventListener('receiving-package-updated', handlePackageMeta);
      window.removeEventListener('receiving-workspace-open', handleWorkspaceOpen);
    };
  }, []);

  // ─── Arm / disarm events from the main panel ────────────────────────────
  useEffect(() => {
    const handleArm = (e: Event) => {
      const detail = (
        e as CustomEvent<{ line_id?: number; sku?: string; item_name?: string }>
      ).detail;
      if (!detail?.line_id) return;
      setArmedLineId(detail.line_id);
    };
    const handleDisarm = () => setArmedLineId(null);

    window.addEventListener('receiving-arm-line', handleArm);
    window.addEventListener('receiving-disarm-line', handleDisarm);
    return () => {
      window.removeEventListener('receiving-arm-line', handleArm);
      window.removeEventListener('receiving-disarm-line', handleDisarm);
    };
  }, []);

  // ─── External receiving-active: main panel selected a pending receiving ─
  useEffect(() => {
    const handleActive = async (e: Event) => {
      const detail = (e as CustomEvent<{ receiving_id?: number }>).detail;
      const id = detail?.receiving_id;
      if (!id) return;
      if (poContext?.receiving_id === id) return;

      try {
        const res = await fetch(`/api/receiving-lines?receiving_id=${id}`);
        const data = await res.json();
        if (!data?.success) return;
        const lines: PoLineSummary[] = (data.receiving_lines || []).map((l: Record<string, unknown>) =>
          mapApiLineToPoSummary(l as Parameters<typeof mapApiLineToPoSummary>[0]),
        );
        const poIds = [
          ...new Set(
            lines
              .map((l) => (l.zoho_purchaseorder_id || '').trim())
              .filter((x) => x.length > 0),
          ),
        ];
        setPoContext({
          receiving_id: id,
          po_ids: poIds,
          lines,
          receiving_package: parseReceivingPackage(data.receiving_package),
        });
        setArmedLineId(null);
      } catch {
        /* ignore — sidebar stays empty */
      }
    };
    window.addEventListener('receiving-active', handleActive);
    return () => window.removeEventListener('receiving-active', handleActive);
  }, [poContext?.receiving_id]);

  const submitTrackingScan = useCallback((rawTracking?: string, opts?: { mode?: UnboxScanMode; onResult?: (result: { tracking: string; matched: boolean; po_ids: string[]; receiving_id?: number; exception_id?: number | null; exception_reason?: string | null; error?: string }) => void }) => {
    const trackingNumber = (rawTracking ?? bulkTracking).trim();
    if (!trackingNumber) return;

    // Resolve the scan route: explicit opts.mode wins, else auto-classify
    // (a value with a dash is an order/PO reference number).
    const lookupMode: UnboxScanMode = opts?.mode ?? classifyUnboxScan(trackingNumber);

    setBulkTracking('');
    const scanStartedAt = Date.now();
    setTrackingLookupInFlight((n) => n + 1);

    // Tell the right pane to show the "Opening your PO" skeleton loader
    // while the Zoho lookup is in flight. ReceivingDashboard listens for
    // `receiving-scan-in-flight` and clears 500ms after `…-resolved`.
    window.dispatchEvent(
      new CustomEvent('receiving-scan-in-flight', {
        detail: { tracking: trackingNumber, startedAt: scanStartedAt },
      }),
    );

    void (async () => {
      try {
        // Serial / unit / carton-handle / receiving-id scan → jump straight to
        // the PO line it belongs to, bypassing carrier tracking intake. Only
        // short-circuits on a hit; tracking numbers and anything unrecognised
        // fall through to the normal lookup-po flow below untouched. Skipped in
        // Order# mode — an order/PO reference is never a serial/carton code.
        try {
          const code = lookupMode === 'order' ? null : await resolveReceivingCodeToLine(trackingNumber);
          if (code && (code.kind === 'line' || code.kind === 'multi')) {
            const rows = code.kind === 'line' ? [code.row] : code.rows;
            if (rows.length > 0) {
              window.dispatchEvent(
                new CustomEvent('receiving-lines-prepended', { detail: rows }),
              );
            }
            const openRows = rows.filter(
              (r) => r.quantity_expected == null || r.quantity_received < (r.quantity_expected ?? 0),
            );
            const pick =
              code.kind === 'line'
                ? code.row
                : openRows.length === 1
                  ? openRows[0]
                  : openRows[0] ?? rows[0] ?? null;
            setScanMatchedRows(rows);
            setLineAccordionBootstrap('default');
            setSelectedLine(pick);
            setScanDriven(true);
            if (code.via === 'serial') {
              toast.success('Found via serial number', {
                description: 'Jumped to the PO that received this unit.',
              });
            }
            window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));
            return;
          }
        } catch {
          /* fall through to carrier tracking intake */
        }

        const res = await fetch('/api/receiving/lookup-po', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trackingNumber,
            staffId: Number(staffId),
            mode: lookupMode,
          }),
        });
        const data = await res.json();

        if (!data?.success) {
          throw new Error(data?.error || 'Lookup failed');
        }

        const isMatched = Boolean(data.matched) && Array.isArray(data.lines) && data.lines.length > 0;

        // Order# lookups that resolve to nothing report a clean not-found —
        // surface a toast instead of falling into the unmatched-carton flow
        // (a mistyped PO/order number must not create a phantom box).
        if (!isMatched && (lookupMode === 'order' || data?.not_found)) {
          opts?.onResult?.({ tracking: trackingNumber, matched: false, po_ids: [] });
          window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));
          toast.error(data?.error || `No PO found for “${trackingNumber}”`);
          return;
        }

        if (isMatched) {
          opts?.onResult?.({
            tracking: trackingNumber,
            matched: true,
            po_ids: Array.isArray(data.po_ids) ? data.po_ids : [],
            receiving_id: Number(data.receiving_id),
          });

          const ctx: PoContext = {
            receiving_id: Number(data.receiving_id),
            po_ids: Array.isArray(data.po_ids) ? data.po_ids : [],
            lines: (data.lines || []).map((l: Record<string, unknown>) =>
              mapApiLineToPoSummary(l as Parameters<typeof mapApiLineToPoSummary>[0]),
            ),
            receiving_package: parseReceivingPackage(data.receiving_package),
          };

          setPoContext(ctx);
          setPendingCandidates([]);

          const openLines = ctx.lines.filter(
            (l) =>
              l.quantity_expected == null ||
              l.quantity_received < (l.quantity_expected ?? 0),
          );
          setArmedLineId(openLines.length === 1 ? openLines[0].id : null);

          // Fetch full ReceivingLineRow[] so the unified LineEditPanel can
          // open directly. Single open line → auto-select. Multiple open →
          // render the scan-line picker above LineEditPanel so the user picks.
          void (async () => {
            try {
              const linesRes = await fetch(`/api/receiving-lines?receiving_id=${ctx.receiving_id}`);
              const linesData = await linesRes.json();
              const rows = Array.isArray(linesData?.receiving_lines)
                ? (linesData.receiving_lines as ReceivingLineRow[])
                : [];
              setScanMatchedRows(rows);
              // Simpler workflow: surface every matched line at the top of the
              // History table immediately. The sidebar's deeper edit flow still
              // runs, but the user no longer has to scroll/search for what just
              // scanned in — and multi-line cartons show in full instead of
              // showing one at a time in the picker.
              if (rows.length > 0) {
                window.dispatchEvent(
                  new CustomEvent('receiving-lines-prepended', { detail: rows }),
                );
              }
              const openRows = rows.filter(
                (r) => r.quantity_expected == null || r.quantity_received < (r.quantity_expected ?? 0),
              );
              // Open LineEditPanel on the first open line (fall back to the first
              // line when all are received). PoLinesAccordion inside the panel
              // lists every line on the PO, so a multi-line carton shows in full
              // — matching the serial-scan path. Previously a multi-open carton
              // left `pick` null, which opened the right-pane overlay with no
              // selected line → a BLANK workspace (a single-line PO worked, two
              // line items did not). Only stays null when the carton has no lines.
              const pick = openRows[0] ?? rows[0] ?? null;
              setLineAccordionBootstrap('default');
              setSelectedLine(pick);
              setScanDriven(true);
            } catch {
              /* silent — sidebar still has poContext for serial scans */
            }
          })();

          // Signal any phone listening on station:{staffId} that this carton
          // is the active one — the phone will auto-open its camera page.
          void publishPhotoRequestFor(ctx.receiving_id, trackingNumber);
          setTimeout(() => serialInputRef.current?.focus(), 60);

          // Tell the right-pane loader we're done — workspace open will
          // cover the swap once the line picker resolves.
          window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));
        } else {
          const exceptionId = typeof data.exception_id === 'number' ? data.exception_id : null;
          const exceptionReason = typeof data.exception_reason === 'string' ? data.exception_reason : null;
          opts?.onResult?.({
            tracking: trackingNumber,
            matched: false,
            po_ids: [],
            receiving_id: typeof data.receiving_id === 'number' ? data.receiving_id : undefined,
            exception_id: exceptionId,
            exception_reason: exceptionReason,
          });
          window.dispatchEvent(
            new CustomEvent('receiving-entry-added', {
              detail: { id: String(data.receiving_id), tracking: trackingNumber },
            }),
          );
          // Auto-open the unfound workspace so the operator can immediately
          // add items via the Ecwid popover — no extra click on the NO PO
          // chip. Fetch any existing lines (a re-scan of the same tracking
          // could have lines from a prior session); fall back to a stub row
          // so UnfoundLineEditPanel mounts with the right receiving_id.
          const unmatchedReceivingId =
            typeof data.receiving_id === 'number' ? data.receiving_id : null;
          if (unmatchedReceivingId != null) {
            void (async () => {
              let openRow: ReceivingLineRow | null = null;
              try {
                const linesRes = await fetch(
                  `/api/receiving-lines?receiving_id=${unmatchedReceivingId}`,
                );
                const linesData = await linesRes.json();
                const rows = Array.isArray(linesData?.receiving_lines)
                  ? (linesData.receiving_lines as ReceivingLineRow[])
                  : [];
                openRow = rows[0] ?? null;
              } catch {
                /* fall through to synthetic stub below */
              }
              if (!openRow) {
                openRow = buildUnmatchedStubRow(
                  unmatchedReceivingId,
                  trackingNumber,
                );
              }
              setLineAccordionBootstrap('default');
              setSelectedLine(openRow);
              setScanDriven(true);
              window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));
            })();
          } else {
            window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Network error';
        opts?.onResult?.({ tracking: trackingNumber, matched: false, po_ids: [], error: message });
        window.dispatchEvent(new CustomEvent('receiving-scan-resolved'));
        toast.error(message);
      } finally {
        setTrackingLookupInFlight((n) => Math.max(0, n - 1));
      }
    })();
  }, [bulkTracking, staffId]);

  // Phone-paired scans: incoming `phone_scan` messages route straight through
  // the same submitTrackingScan flow as if the desktop scanner had fired it.
  // After the lookup, echo the result back on the station channel so the
  // phone's result UI can show matched/unmatched without a round-trip DB query.
  // (phoneChannelName / stationChannelName / getAblyClient are hoisted to
  //  the top of this component so the photo-request publisher can use them.)

  useAblyChannel(
    phoneChannelName,
    'phone_scan',
    (msg: { data?: { tracking?: string } }) => {
      const tracking = String(msg?.data?.tracking || '').trim();
      if (!tracking) return;
      submitTrackingScan(tracking, {
        onResult: async (result) => {
          try {
            const client = await getAblyClient();
            if (!client) return;
            const ch = client.channels.get(stationChannelName);
            await ch.publish('phone_scan_result', {
              tracking: result.tracking,
              matched: result.matched,
              po_ids: result.po_ids,
              receiving_id: result.receiving_id ?? null,
              exception_id: result.exception_id ?? null,
              exception_reason: result.exception_reason ?? null,
              error: result.error ?? null,
            });
          } catch (err) {
            console.warn('phone_scan_result publish failed', err);
          }
        },
      });
    },
    Number(staffId) > 0,
  );

  // ─── Unboxing mode: serial scan → scan-serial → bump qty, maybe print ───
  const submitSerialScan = useCallback(
    async (explicitLineId?: number, rawSerial?: string) => {
      const serial = (rawSerial ?? serialInput).trim();
      if (!serial || !poContext || serialSubmitting) return;

      setSerialSubmitting(true);
      setPendingCandidates([]);

      const effectiveLineId = explicitLineId ?? armedLineId;

      try {
        const res = await fetch('/api/receiving/scan-serial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receiving_id: poContext.receiving_id,
            receiving_line_id: effectiveLineId ?? undefined,
            serial_number: serial,
            staff_id: Number(staffId),
          }),
        });
        const data = await res.json();

        if (data?.needs_line_selection) {
          setPendingCandidates(data.candidate_lines || []);
          return;
        }

        if (!data?.success) {
          toast.error(data?.error || `Scan failed (${res.status})`);
          return;
        }

        // Same serial already on this line — friendly no-op. Serials are
        // sidecar metadata, so this never affects quantity.
        if (data.already_attached) {
          toast.info(`Already added — ${serial}`);
          setSerialInput('');
          setTimeout(() => serialInputRef.current?.focus(), 40);
          return;
        }

        const state: {
          id: number;
          sku: string | null;
          item_name: string | null;
          quantity_received: number;
          quantity_expected: number | null;
          workflow_status?: string | null;
          is_complete: boolean;
        } = data.line_state;

        // Clear input immediately for the next scan
        setSerialInput('');

        // Return detection banner
        if (data.is_return) {
          setReturns((prev) =>
            [
              {
                id: randomId(),
                serial_number: serial,
                line_id: state.id,
                sku: state.sku,
                prior_status: data.prior_status ?? null,
                at: Date.now(),
              },
              ...prev,
            ].slice(0, 3),
          );
        }

        // Print-on-scan (unboxing only, opt-out via toggle)
        if (printOnScan && state.sku) {
          printProductLabel({
            sku: state.sku,
            title: state.item_name ?? undefined,
            serialNumber: serial,
          });
        }

        // Broadcast to main panel so the chip list refreshes. Quantity is
        // unchanged by a serial scan — no qty payload here.
        window.dispatchEvent(
          new CustomEvent('receiving-serial-scanned', {
            detail: {
              line_id: state.id,
              serial_unit: data.serial_unit,
              is_return: !!data.is_return,
            },
          }),
        );

        setTimeout(() => serialInputRef.current?.focus(), 40);
      } catch {
        /* silently fail — user can re-scan */
      } finally {
        setSerialSubmitting(false);
      }
    },
    [serialInput, poContext, armedLineId, serialSubmitting, staffId, printOnScan],
  );

  const clearPoContext = useCallback(() => {
    setPoContext(null);
    setArmedLineId(null);
    setPendingCandidates([]);
    setSerialInput('');
  }, []);

  // Selection must NOT carry across modes. On a genuine mode SWITCH (not the
  // initial mount — that would clobber a deep-linked carton), converge both
  // panes on empty so the new mode re-renders fresh and its rail auto-selects
  // the top of its OWN queue. A carton opened in Unbox never lingers selected in
  // Receiving/Incoming, and clicking a mode shows that mode's most-recent item
  // instead of a stale background.
  const prevModeForResetRef = useRef<ReceivingMode | null>(null);
  useEffect(() => {
    const prev = prevModeForResetRef.current;
    prevModeForResetRef.current = mode;
    if (prev === null || prev === mode) return;
    setSelectedLine(null);
    setLineAccordionBootstrap('default');
    setScanDriven(false);
    setScanMatchedRows([]);
    clearPoContext();
    window.dispatchEvent(new CustomEvent('receiving-clear-line'));
  }, [mode, clearPoContext]);

  const { updateSourcePlatform } = useReceivingSourcePlatform({ poContext, setPoContext });

  const dismissReturn = useCallback((id: string) => {
    setReturns((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const updateMode = (nextMode: ReceivingMode) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('mode', nextMode);
    const finalParams =
      nextMode !== 'history' ? clearReceivingHistoryUrlParams(nextParams) : nextParams;
    router.replace(`/receiving?${finalParams.toString()}`);
  };

  const updateStaff = (id: number) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('staffId', String(id));
    router.replace(`/receiving?${nextParams.toString()}`);
  };

  const updateUnboxView = (next: 'recent' | 'queue') => {
    if (next === unboxView) return;
    // Different list = don't carry the prior pick; let the new list auto-select
    // its own top (mirrors the triage Found/Unfound toggle).
    window.dispatchEvent(new CustomEvent('receiving-clear-line'));
    const nextParams = new URLSearchParams(searchParams.toString());
    if (next === 'recent') nextParams.delete('unboxview');
    else nextParams.set('unboxview', next);
    router.replace(`/receiving?${nextParams.toString()}`);
  };

  // Mobile receiving used to be photo-only, but we now use RouteShell
  // to surface this panel as the "Actions" tab.
  const isMobileView = isMobile;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {!masterNavEnabled && (
        <div className={sidebarHeaderPillRowClass}>
          <HorizontalButtonSlider
            items={RECEIVING_MODE_ITEMS}
            value={mode}
            onChange={(next) => updateMode(next as ReceivingMode)}
            variant="segmented"
            className="w-full"
            aria-label="Receiving mode"
          />
        </div>
      )}

      {mode === 'pickup' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <LocalPickupSidebarList />
        </div>
      ) : mode === 'incoming' ? (
        // Incoming = Zoho-sourced expected work. Sidebar owns the search +
        // facet controls; the right-pane table renders the rows only (no
        // duplicate header). Scan-bar is intentionally omitted — Incoming
        // is a browse/triage surface, not a scan surface.
        <div className="min-h-0 flex-1 overflow-hidden">
          <IncomingSidebarPanel />
        </div>
      ) : (
        <>
      {/* History: dashboard-style search + scope/field pills + green + to Receive.
          Triage: desktop SearchBar over the Found/Unfound to-do lists (no scan).
          Receive (Unbox): tracking scan bar opens the workspace. */}
      {mode === 'history' ? (
        <ReceivingHistorySearchSection
          onSwitchToReceiving={() => updateMode('receive')}
        />
      ) : mode === 'triage' ? (
        <div className={cn(receivingScanBandClass, SIDEBAR_GUTTER, 'py-1')}>
          <SearchBar
            value={triageQuery}
            onChange={setTriageQuery}
            onClear={() => setTriageQuery('')}
            placeholder="Search triage — tracking, PO #, SKU…"
            variant="orange"
            debounceMs={120}
          />
        </div>
      ) : (
      <motion.div
        // Soft staff-color tint hints at the active operator's theme without
        // shouting. Entrance is a snappy fade + slide-in from left so a mode
        // flip (history → receive) feels like the bar is *arriving*.
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 120 }}
        className={cn(receivingScanBandClass, bandHaloClass[themeColor], SIDEBAR_GUTTER, 'py-1')}
      >
        <ReceivingUnboxScanBar
          value={bulkTracking}
          onChange={setBulkTracking}
          onSubmit={(mode) => submitTrackingScan(undefined, { mode })}
          inputRef={scanInputRef}
          isResolving={trackingLookupInFlight > 0}
          staffId={staffId}
          armedMode={unboxScanMode}
          onToggleMode={(m) => setUnboxScanMode((prev) => (prev === m ? null : m))}
        />
      </motion.div>
      )}

      <ReceivingReturnBanner returns={returns} onDismiss={dismissReturn} />

      {/* Scrollable body — picker + rails. Editor lives in the right pane;
          closing the workspace clears selectedLine via the
          `receiving-workspace-close` listener above. */}
      <div className="min-h-0 flex-1 overflow-auto">

      {/* Unbox mode: Recent / Queue toggle pinned at the top of the rail (mirrors
          the triage Found/Unfound pills). Recent = the live unboxing feed; Queue
          = the priority-sorted Scanned list (unfound/untagged first, then
          amazon → ebay → goodwill). URL-backed via `unboxview`. */}
      {mode === 'receive' && (
        <div className="sticky top-0 z-10 bg-white/90 px-3 pb-1.5 pt-1 backdrop-blur">
          <HorizontalButtonSlider
            items={[
              { id: 'queue', label: 'Queue', icon: Layers },
              { id: 'recent', label: 'Recent', icon: Clock },
            ]}
            value={unboxView}
            onChange={(id) => updateUnboxView(id as 'recent' | 'queue')}
            variant="nav"
            dense
            aria-label="Unbox queue view"
          />
        </div>
      )}

      {/* Multi-match picker — shown when a tracking scan resolves to >1 open
          lines and the user hasn't picked one. Single matches skip this. */}
      {scanDriven && !selectedLine && scanMatchedRows.length > 1 && (
        <ReceivingLinePicker
          rows={scanMatchedRows}
          onPick={(line) => {
            setLineAccordionBootstrap('default');
            setSelectedLine(line);
          }}
          onCancel={() => {
            setScanDriven(false);
            setScanMatchedRows([]);
            clearPoContext();
          }}
        />
      )}

      {/* Receive tab: live recent rail. History narrows the right-pane
          table via URL params and doesn't need the rail. Incoming has its
          own dedicated sidebar (IncomingSidebarPanel) above this branch.
          Triage (label "Receiving") swaps the rail for a Found/Unfound toggle:
          Found = the same received rail, Unfound = the door-scan triage list. */}
      {mode === 'history' ? null : mode === 'triage' ? (
        <TriageSidebarBody
          selectedLineId={selectedLine?.id ?? null}
          selectedRow={selectedLine && selectedLine.id > 0 ? selectedLine : null}
          filterText={triageQuery}
        />
      ) : unboxView === 'queue' ? (
        // Unbox "Queue" toggle — the same priority-sorted Scanned rail the triage
        // Prioritize tab uses (unfound/untagged first, then amazon → ebay →
        // goodwill), so the operator can work the queue top-down.
        <ReceivingScannedRail
          selectedLineId={selectedLine?.id ?? null}
          selectedRow={selectedLine && selectedLine.id > 0 ? selectedLine : null}
        />
      ) : (
        <ReceivingRecentRail
          // Keep the (possibly negative) id so the rail's auto-select stays
          // suppressed while a line/carton is open — but never hand it the
          // synthetic unmatched-carton stub as a pinnable row. buildUnmatchedStubRow
          // negates the id; pinning it surfaced a phantom "Line #-<recvId> 0/?"
          // entry that lingered after the real line was deleted.
          selectedLineId={selectedLine?.id ?? null}
          selectedRow={selectedLine && selectedLine.id > 0 ? selectedLine : null}
        />
      )}

      </div>{/* /scrollable body */}
        </>
      )}
    </div>
  );
}
