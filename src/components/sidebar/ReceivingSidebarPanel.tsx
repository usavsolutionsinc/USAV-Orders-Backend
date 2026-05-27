'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from '@/lib/toast';
import { sidebarHeaderBandClass } from '@/components/layout/header-shell';
import { Barcode, Loader2, X } from '@/components/Icons';
import { useUIModeOptional } from '@/design-system/providers/UIModeProvider';
import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import {
  ReceivingReturnBanner,
  type ReturnEvent,
} from '@/components/sidebar/ReceivingReturnBanner';
import { StationScanBar } from '@/components/station/StationScanBar';
import { ReceivingHistorySearchSection } from '@/components/sidebar/receiving/ReceivingHistorySearchSection';
import { ReceivingLinePicker } from '@/components/sidebar/receiving/ReceivingLinePicker';
import { ReceivingRecentRail } from '@/components/sidebar/receiving/ReceivingRecentRail';
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
import { printProductLabel } from '@/lib/print/printProductLabel';
import { LocalPickupIntakeForm } from '@/components/work-orders/LocalPickupIntakeForm';
import { UnfoundQueueSidebarToolbar } from '@/components/receiving/unfound/UnfoundQueueSidebarToolbar';
import {
  dispatchLineUpdated,
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
  type ReceivingPackageMeta,
  type PoContext,
  type OpenException,
  type ReceivingSelectLineDetail,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';
import { clearReceivingHistoryUrlParams } from '@/lib/receiving-history-search';
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
  const pathname = usePathname();
  const { isMobile } = useUIModeOptional();
  const rawMode = searchParams.get('mode');
  // /receiving/unfound owns its own mode — pathname takes precedence over
  // ?mode= so the Unfound pill stays highlighted on the dedicated route.
  const isUnfoundRoute = pathname?.startsWith('/receiving/unfound') ?? false;
  const mode: ReceivingMode = isUnfoundRoute
    ? 'unfound'
    : rawMode === 'pickup'
      ? 'pickup'
      : rawMode === 'history'
        ? 'history'
        : rawMode === 'incoming'
          ? 'incoming'
          : 'receive';
  // Identity is server-derived. The proxy redirects unauthenticated traffic
  // to /signin, so `user` is non-null whenever this sidebar renders. The
  // optional-chain is a TS-narrowing nicety, not a runtime fallback.
  const { user } = useAuth();
  const staffIdNum = user?.staffId ?? 0;
  const staffId = String(staffIdNum);
  const { theme: themeColor, inputBorder } = useStationTheme({ staffId: staffIdNum });
  const focusRingClass: Record<typeof themeColor, string> = {
    green: 'focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500',
    blue: 'focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500',
    purple: 'focus:ring-4 focus:ring-purple-500/10 focus:border-purple-500',
    yellow: 'focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500',
    black: 'focus:ring-4 focus:ring-slate-700/10 focus:border-slate-700',
    red: 'focus:ring-4 focus:ring-red-500/10 focus:border-red-500',
    lightblue: 'focus:ring-4 focus:ring-sky-500/10 focus:border-sky-500',
    pink: 'focus:ring-4 focus:ring-pink-500/10 focus:border-pink-500',
  };
  const scanIconColorClass: Record<typeof themeColor, string> = {
    green: 'text-emerald-600',
    blue: 'text-blue-600',
    purple: 'text-purple-600',
    yellow: 'text-amber-600',
    black: 'text-slate-700',
    red: 'text-red-600',
    lightblue: 'text-sky-600',
    pink: 'text-pink-600',
  };
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
    // Returning to the Receive tab from History / Pickup / Unfound — focus
    // the tracking field (the scan-bar effect above listens for this event).
    if (mode === 'receive') {
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('receiving-focus-scan'));
      });
    }
  }, [mode]);

  const [bulkTracking, setBulkTracking] = useState('');
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
  const [openExceptions, setOpenExceptions] = useState<OpenException[]>([]);
  const [refreshingExceptionIds, setRefreshingExceptionIds] = useState<Set<number>>(new Set());

  const fetchOpenExceptions = useCallback(async () => {
    try {
      const res = await fetch('/api/tracking-exceptions?domain=receiving&status=open&limit=50', {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!data?.success) return;
      const rows = Array.isArray(data.rows) ? data.rows : [];
      setOpenExceptions(
        rows.map((r: Record<string, unknown>) => ({
          id: Number(r.id),
          tracking_number: String(r.tracking_number || ''),
          exception_reason: String(r.exception_reason || 'not_found'),
          created_at: String(r.created_at || ''),
          last_zoho_check_at: r.last_zoho_check_at ? String(r.last_zoho_check_at) : null,
          zoho_check_count: Number(r.zoho_check_count || 0),
        })),
      );
    } catch {
      /* silent — sidebar keeps prior list */
    }
  }, []);

  useEffect(() => {
    void fetchOpenExceptions();
  }, [fetchOpenExceptions]);

  const refreshException = useCallback(
    async (exceptionId: number) => {
      setRefreshingExceptionIds((prev) => {
        const next = new Set(prev);
        next.add(exceptionId);
        return next;
      });
      try {
        const res = await fetch(`/api/tracking-exceptions/${exceptionId}/refresh`, {
          method: 'POST',
        });
        await res.json().catch(() => null);
      } catch {
        /* ignore — fetchOpenExceptions below reflects whatever state is real */
      } finally {
        setRefreshingExceptionIds((prev) => {
          const next = new Set(prev);
          next.delete(exceptionId);
          return next;
        });
        await fetchOpenExceptions();
      }
    },
    [fetchOpenExceptions],
  );
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
  const [printOnScan, setPrintOnScan] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem('receiving.printOnScan');
    return stored === null ? true : stored === 'true';
  });
  const serialInputRef = useRef<HTMLInputElement>(null);

  const armedLine = useMemo<PoLineSummary | null>(() => {
    if (armedLineId == null || !poContext) return null;
    return poContext.lines.find((l) => l.id === armedLineId) ?? null;
  }, [armedLineId, poContext]);

  // When the user row-clicks a line in the dashboard table, scanMatchedRows
  // is empty — which would disable the up/down nav. Populate it lazily by
  // fetching all sibling lines for the same receiving_id. Skipped when
  // scanMatchedRows already contains the selected line (scan-driven entry
  // or a prior fetch).
  useEffect(() => {
    const receivingId = selectedLine?.receiving_id;
    if (!receivingId) return;
    if (scanMatchedRows.some((r) => r.id === selectedLine.id)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/receiving-lines?receiving_id=${receivingId}`);
        const data = await res.json();
        if (cancelled) return;
        const rows = Array.isArray(data?.receiving_lines)
          ? (data.receiving_lines as ReceivingLineRow[])
          : [];
        if (rows.length > 0) {
          setScanMatchedRows(rows);
          setSelectedLine((prev) => {
            if (!prev) return prev;
            const hit = rows.find((r) => r.id === prev.id);
            return hit ?? prev;
          });
        }
      } catch { /* silent — nav stays disabled if fetch fails */ }
    })();
    return () => { cancelled = true; };
  }, [selectedLine, scanMatchedRows]);

  // Navigation + progress derived from the full sibling-line list. Counter
  // sums *units* across every matched line (received vs expected) so the pill
  // mirrors the table row's quantityText (e.g. 0/5) instead of a line count
  // (0/1). A line with workflow_status=DONE is treated as fully received even
  // if quantity_received lags behind the expectation.
  const { currentIndex, canPrev, canNext, progressReceived, progressTotal } = useMemo(() => {
    if (!selectedLine || scanMatchedRows.length === 0) {
      return { currentIndex: -1, canPrev: false, canNext: false, progressReceived: 0, progressTotal: 0 };
    }
    const idx = scanMatchedRows.findIndex((r) => r.id === selectedLine.id);
    let receivedUnits = 0;
    let totalUnits = 0;
    for (const r of scanMatchedRows) {
      const expected = Math.max(0, Number(r.quantity_expected ?? 0));
      const received = Math.max(0, Number(r.quantity_received ?? 0));
      const isDone = String(r.workflow_status || '').toUpperCase() === 'DONE';
      const expectedSafe = expected > 0 ? expected : 1;
      totalUnits += expectedSafe;
      receivedUnits += isDone ? expectedSafe : Math.min(received, expectedSafe);
    }
    return {
      currentIndex: idx,
      canPrev: idx > 0,
      canNext: idx >= 0 && idx < scanMatchedRows.length - 1,
      progressReceived: receivedUnits,
      progressTotal: totalUnits,
    };
  }, [selectedLine, scanMatchedRows]);

  // Prev/next flips the local selectedLine and fires the dedicated
  // receiving-highlight-line event so the dashboard table's blue row
  // indicator follows along. We avoid dispatching receiving-select-line
  // because that handler wipes scanMatchedRows (row-click semantics) and
  // would break subsequent nav.
  const goPrevLine = useCallback(() => {
    if (currentIndex <= 0) return;
    const target = scanMatchedRows[currentIndex - 1];
    if (target) {
      setLineAccordionBootstrap('default');
      setSelectedLine(target);
      window.dispatchEvent(new CustomEvent('receiving-highlight-line', { detail: target.id }));
    }
  }, [currentIndex, scanMatchedRows]);

  const goNextLine = useCallback(() => {
    if (currentIndex < 0 || currentIndex >= scanMatchedRows.length - 1) return;
    const target = scanMatchedRows[currentIndex + 1];
    if (target) {
      setLineAccordionBootstrap('default');
      setSelectedLine(target);
      window.dispatchEvent(new CustomEvent('receiving-highlight-line', { detail: target.id }));
    }
  }, [currentIndex, scanMatchedRows]);

  // Arrow keys move the main table selection (same as carton header chevrons).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      if (!selectedLine) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      window.dispatchEvent(
        new CustomEvent('receiving-navigate-table', {
          detail: event.key === 'ArrowUp' ? 'prev' : 'next',
        }),
      );
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedLine]);

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

  // History-mode row clicks route through the `receiving-select-line` listener
  // below — they fire `receiving-open-details-overlay` directly instead of
  // touching `selectedLine`, so no mode-bounce effect is needed here.

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('receiving.printOnScan', String(printOnScan));
  }, [printOnScan]);

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

  const submitTrackingScan = useCallback((rawTracking?: string, opts?: { onResult?: (result: { tracking: string; matched: boolean; po_ids: string[]; receiving_id?: number; exception_id?: number | null; exception_reason?: string | null; error?: string }) => void }) => {
    const trackingNumber = (rawTracking ?? bulkTracking).trim();
    if (!trackingNumber) return;

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
        const res = await fetch('/api/receiving/lookup-po', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trackingNumber,
            staffId: Number(staffId),
          }),
        });
        const data = await res.json();

        if (!data?.success) {
          throw new Error(data?.error || 'Lookup failed');
        }

        const isMatched = Boolean(data.matched) && Array.isArray(data.lines) && data.lines.length > 0;

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
              const pick = openRows.length === 1 ? openRows[0] : openRows.length === 0 && rows.length === 1 ? rows[0] : null;
              if (pick) {
                setLineAccordionBootstrap('default');
                setSelectedLine(pick);
                setScanDriven(true);
              } else {
                setLineAccordionBootstrap('default');
                setSelectedLine(null);
                setScanDriven(true);
              }
            } catch {
              /* silent — sidebar still has poContext for serial scans */
            }
          })();

          // Signal any phone listening on station:{staffId} that this carton
          // is the active one — the phone will auto-open its camera page.
          void publishPhotoRequestFor(ctx.receiving_id, trackingNumber);
          setTimeout(() => serialInputRef.current?.focus(), 60);

          // Matched path may have resolved a prior open exception; refresh list.
          void fetchOpenExceptions();
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
          // Unmatched path always upserts into tracking_exceptions — surface it.
          void fetchOpenExceptions();

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
  }, [bulkTracking, staffId, fetchOpenExceptions]);

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

        if (data.already_complete) {
          toast.info('This order has already been fully received.', {
            description: serial ? `Barcode: ${serial}` : undefined,
          });
          setSerialInput('');
          setTimeout(() => serialInputRef.current?.focus(), 40);
          return;
        }

        if (data.already_received) {
          toast.info(`Already received — ${serial}`);
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

        dispatchLineUpdated({
          id: state.id,
          quantity_received: state.quantity_received,
          quantity_expected: state.quantity_expected,
          workflow_status: state.workflow_status ?? undefined,
        });

        // Optimistic local update
        setPoContext((prev) => {
          if (!prev) return prev;
          const nextLines = prev.lines.map((l) =>
            l.id === state.id
              ? { ...l, quantity_received: state.quantity_received }
              : l,
          );
          return { ...prev, lines: nextLines };
        });

        // Auto-advance arming when the armed line is complete
        if (state.is_complete && armedLineId === state.id) {
          setPoContext((prev) => {
            if (!prev) return prev;
            const remainingOpen = prev.lines.filter(
              (l) =>
                l.id !== state.id &&
                (l.quantity_expected == null ||
                  l.quantity_received < (l.quantity_expected ?? 0)),
            );
            setArmedLineId(remainingOpen.length === 1 ? remainingOpen[0].id : null);
            return prev;
          });
        }

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

        // Broadcast to main panel
        window.dispatchEvent(
          new CustomEvent('receiving-serial-scanned', {
            detail: {
              line_id: state.id,
              new_qty: state.quantity_received,
              serial_unit: data.serial_unit,
              is_return: !!data.is_return,
              is_complete: !!state.is_complete,
            },
          }),
        );

        if (state.is_complete) {
          window.dispatchEvent(
            new CustomEvent('receiving-line-complete', {
              detail: { line_id: state.id },
            }),
          );
        }

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

  const updateSourcePlatform = useCallback(async (next: string) => {
    if (!poContext) return;
    const normalized = (next || '').toLowerCase();
    const packageUpdate: ReceivingPackageMeta = {
      received_at: poContext.receiving_package?.received_at ?? null,
      unboxed_at: poContext.receiving_package?.unboxed_at ?? null,
      created_at: poContext.receiving_package?.created_at ?? null,
      return_platform: poContext.receiving_package?.return_platform ?? null,
      source_platform: normalized || null,
      is_return: poContext.receiving_package?.is_return ?? false,
    };
    setPoContext((prev) => (prev ? { ...prev, receiving_package: packageUpdate } : prev));
    const receivingId = poContext.receiving_id;
    try {
      await fetch(`/api/receiving/${receivingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_platform: normalized || null }),
      });
      window.dispatchEvent(new CustomEvent('receiving-package-updated', {
        detail: { receiving_id: receivingId, source_platform: normalized || null },
      }));
    } catch {
      /* silent — realtime invalidation will reconcile */
    }
  }, [poContext]);

  // Mirror platform changes originating from a line inspector back into the
  // top PO card's context so the label + dropdown reflect immediately.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ receiving_id?: number; source_platform?: string | null }>).detail;
      if (!detail || detail.source_platform === undefined) return;
      setPoContext((prev) => {
        if (!prev || prev.receiving_id !== detail.receiving_id) return prev;
        const nextPkg: ReceivingPackageMeta = {
          received_at: prev.receiving_package?.received_at ?? null,
          unboxed_at: prev.receiving_package?.unboxed_at ?? null,
          created_at: prev.receiving_package?.created_at ?? null,
          return_platform: prev.receiving_package?.return_platform ?? null,
          source_platform: (detail.source_platform || '').toLowerCase() || null,
          is_return: prev.receiving_package?.is_return ?? false,
        };
        return { ...prev, receiving_package: nextPkg };
      });
    };
    window.addEventListener('receiving-package-updated', handler);
    return () => window.removeEventListener('receiving-package-updated', handler);
  }, []);

  const dismissReturn = useCallback((id: string) => {
    setReturns((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const updateMode = (nextMode: ReceivingMode) => {
    // 'unfound' is its own route, not a query-param mode.
    if (nextMode === 'unfound') {
      router.push('/receiving/unfound');
      return;
    }
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('mode', nextMode);
    const finalParams =
      nextMode !== 'history' ? clearReceivingHistoryUrlParams(nextParams) : nextParams;
    // Coming back from /receiving/unfound — push to /receiving so the
    // workspace mounts; for in-section mode flips, replace preserves history.
    const target = `/receiving?${finalParams.toString()}`;
    if (isUnfoundRoute) router.push(target);
    else router.replace(target);
  };

  const updateStaff = (id: number) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('staffId', String(id));
    router.replace(`/receiving?${nextParams.toString()}`);
  };

  // Mobile receiving used to be photo-only, but we now use RouteShell
  // to surface this panel as the "Actions" tab.
  const isMobileView = isMobile;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Mode pills (2nd row) */}
      <div className={`${sidebarHeaderBandClass} px-3`}>
        <HorizontalButtonSlider
          items={RECEIVING_MODE_ITEMS}
          value={mode}
          onChange={(next) => updateMode(next as ReceivingMode)}
          variant="nav"
          aria-label="Receiving mode"
        />
      </div>

      {mode === 'pickup' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <LocalPickupIntakeForm variant="sidebar" staffId={staffId} />
        </div>
      ) : mode === 'unfound' ? (
        // Unfound queue lives in the right pane (UnfoundQueueTable). The
        // sidebar carries the toolbar (filter pills + search + refresh) so
        // the right pane is pure data and the sidebar is pure control.
        <div className="min-h-0 flex-1 overflow-y-auto">
          <UnfoundQueueSidebarToolbar />
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
          Receive: tracking scan bar opens the workspace. */}
      {mode === 'history' ? (
        <ReceivingHistorySearchSection
          onSwitchToReceiving={() => updateMode('receive')}
        />
      ) : (
      <motion.div
        // Soft staff-color tint hints at the active operator's theme without
        // shouting. Entrance is a snappy fade + slide-in from left so a mode
        // flip (history → receive) feels like the bar is *arriving*.
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 120 }}
        className={`shrink-0 border-b border-gray-300 ${bandHaloClass[themeColor]} flex min-h-[44px] items-center px-3 py-1`}
      >
        <StationScanBar
          value={bulkTracking}
          onChange={setBulkTracking}
          onSubmit={() => submitTrackingScan()}
          inputRef={scanInputRef}
          placeholder="Tracking, PO #"
          icon={<Barcode className={`h-[17px] w-[17px] ${scanIconColorClass[themeColor]}`} />}
          iconClassName=""
          inputBorderClassName={inputBorder}
          inputClassName={`pl-[2.2rem] ${focusRingClass[themeColor]}`}
          autoFocus
          className="w-full"
          rightContentClassName="right-1.5 gap-0.5"
          rightContent={
            trackingLookupInFlight > 0 ? (
              <Loader2 className="h-4 w-4 animate-spin text-gray-700" />
            ) : (
              <div className="h-6 min-w-6 px-1 bg-white rounded border border-gray-100 shadow-sm flex items-center justify-center">
                <span className="text-mini font-black text-gray-400">ENTER</span>
              </div>
            )
          }
        />
      </motion.div>
      )}

      <ReceivingReturnBanner returns={returns} onDismiss={dismissReturn} />

      {/* Scrollable body — picker + rails. Editor lives in the right pane;
          closing the workspace clears selectedLine via the
          `receiving-workspace-close` listener above. */}
      <div className="min-h-0 flex-1 overflow-auto">

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
          own dedicated sidebar (IncomingSidebarPanel) above this branch. */}
      {mode === 'history' ? null : (
        <ReceivingRecentRail
          selectedLineId={selectedLine?.id ?? null}
          selectedRow={selectedLine ?? null}
        />
      )}

      </div>{/* /scrollable body */}
        </>
      )}
    </div>
  );
}
