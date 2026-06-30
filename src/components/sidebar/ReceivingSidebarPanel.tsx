'use client';

/**
 * Receiving sidebar — thin composition layer.
 *
 * All business logic lives in focused hooks under `./receiving/`:
 *   - useReceivingMode .............. URL ⇄ mode + Unbox sub-view + nav
 *   - usePoContext .................. active carton + armed line
 *   - useSerialScan ................. serial scan + returns banner
 *   - useReceivingSourcePlatform .... source-platform mirror (side effect)
 *   - useReceivingSelection ........ selected line + inbound event bridges
 *   - useReceivingLineNavigation ... sibling-line nav + progress
 *   - useReceivingWorkspaceBridge .. outbound right-pane workspace dispatch
 *   - useTrackingScan .............. the tracking/PO/handle scan orchestration
 *   - usePhoneScanBridge ........... phone-paired scan round-trip
 *   - usePhotoRequestPublisher ..... nudge the paired phone's camera open
 *   - useRailEditMode .............. pencil bulk-select + bulk delete
 *
 * The render is pure composition of presentational subcomponents. Nothing here
 * fetches, mutates, or computes — it only wires hooks to UI.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useAblyClient } from '@/contexts/AblyContext';
import { useStationTheme } from '@/hooks/useStationTheme';
import { useMasterNavEnabled } from '@/components/sidebar/master-nav';
import {
  safeChannelName,
  getPhoneBridgeChannelName,
  getStaffStationBridgeChannelName,
} from '@/lib/realtime/channels';

import { RailEditModeProvider } from '@/components/sidebar/rail-edit-mode';
import { dispatchSelectLine } from '@/components/station/receiving-lines-table-helpers';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { buildUnmatchedStubRow } from '@/components/sidebar/receiving/receiving-sidebar-shared';
import { safeRandomUUID } from '@/lib/safe-uuid';
import type { TrackingScanResult } from '@/components/sidebar/receiving/useTrackingScan';
import { ReceivingReturnBanner } from '@/components/sidebar/ReceivingReturnBanner';
import { ReceivingHistorySearchSection } from '@/components/sidebar/receiving/ReceivingHistorySearchSection';
import { ReceivingLinePicker } from '@/components/sidebar/receiving/ReceivingLinePicker';
import { IncomingSidebarPanel } from '@/components/sidebar/receiving/IncomingSidebarPanel';
import { LocalPickupSidebarList } from '@/components/work-orders/LocalPickupSidebarList';

import { ReceivingModeSwitcher } from '@/components/sidebar/receiving/ReceivingModeSwitcher';
import { TriageScanBand, UnboxScanBand } from '@/components/sidebar/receiving/ReceivingScanBands';
import { UnboxViewToggle } from '@/components/sidebar/receiving/UnboxViewToggle';
import { TriageViewToggle } from '@/components/sidebar/receiving/TriageViewToggle';
import { ReceivingRailBody } from '@/components/sidebar/receiving/ReceivingRailBody';
import { ReceivingBulkActionBar } from '@/components/sidebar/receiving/ReceivingBulkActionBar';

import { useReceivingMode } from '@/components/sidebar/receiving/useReceivingMode';
import { usePoContext } from '@/components/sidebar/receiving/usePoContext';
import { useSerialScan } from '@/components/sidebar/receiving/useSerialScan';
import { useReceivingSourcePlatform } from '@/components/sidebar/receiving/useReceivingSourcePlatform';
import { useReceivingSelection } from '@/components/sidebar/receiving/useReceivingSelection';
import { useReceivingLineNavigation } from '@/components/sidebar/receiving/useReceivingLineNavigation';
import { useReceivingWorkspaceBridge } from '@/components/sidebar/receiving/useReceivingWorkspaceBridge';
import { useTrackingScan } from '@/components/sidebar/receiving/useTrackingScan';
import { usePhoneScanBridge } from '@/components/sidebar/receiving/usePhoneScanBridge';
import { usePhotoRequestPublisher } from '@/components/sidebar/receiving/usePhotoRequestPublisher';
import { useRailEditMode } from '@/components/sidebar/receiving/useRailEditMode';

export function ReceivingSidebarPanel() {
  const queryClient = useQueryClient();
  const masterNavEnabled = useMasterNavEnabled();

  // Identity is server-derived (the proxy redirects unauthenticated traffic to
  // /signin), so `user` is non-null whenever this sidebar renders.
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const staffIdNum = user?.staffId ?? 0;
  const staffId = String(staffIdNum);
  const { theme: themeColor, inputBorder } = useStationTheme({ staffId: staffIdNum });

  // ── Realtime channels + photo-request publisher ──────────────────────────
  const { getClient: getAblyClient } = useAblyClient();
  const phoneChannelName = safeChannelName(() => getPhoneBridgeChannelName(orgId!, staffIdNum));
  const stationChannelName = safeChannelName(() =>
    getStaffStationBridgeChannelName(orgId!, staffIdNum),
  );
  const publishPhotoRequestFor = usePhotoRequestPublisher({
    staffIdNum,
    getAblyClient,
    stationChannelName,
  });

  // ── Mode / sub-view (URL-backed) ─────────────────────────────────────────
  const { mode, unboxView, triageView, isScanSurface, updateMode, updateUnboxView, updateTriageView } =
    useReceivingMode();

  // ── Unbox session: PO context + serial scan ──────────────────────────────
  const { poContext, setPoContext, armedLineId, setArmedLineId, clearPoContext } = usePoContext();
  const {
    serialInputRef,
    returns,
    setPendingCandidates,
    dismissReturn,
    clearReturns,
    resetSerialInputs,
  } = useSerialScan({ poContext, armedLineId, staffId });

  // Source-platform mirror — called for its `receiving-package-updated` event
  // bridge side effect (the returned setter is owned by the line inspector).
  useReceivingSourcePlatform({ poContext, setPoContext });

  // Clearing a scan session resets the PO context + serial inputs together.
  const clearScanSession = useCallback(() => {
    clearPoContext();
    resetSerialInputs();
  }, [clearPoContext, resetSerialInputs]);

  // ── Selection + navigation + right-pane bridge ───────────────────────────
  const {
    selectedLine,
    setSelectedLine,
    scanMatchedRows,
    setScanMatchedRows,
    lineAccordionBootstrap,
    setLineAccordionBootstrap,
    scanDriven,
    setScanDriven,
  } = useReceivingSelection({ mode, clearScanSession });

  const { currentIndex, canPrev, canNext } = useReceivingLineNavigation({
    selectedLine,
    scanMatchedRows,
    setSelectedLine,
    setScanMatchedRows,
    setLineAccordionBootstrap,
  });

  useReceivingWorkspaceBridge({
    selectedLine,
    lineAccordionBootstrap,
    scanDriven,
    scanMatchedRows,
    currentIndex,
    canPrev,
    canNext,
  });

  // ── Tracking scan (+ phone-paired bridge) ────────────────────────────────
  const {
    bulkTracking,
    setBulkTracking,
    unboxScanMode,
    setUnboxScanMode,
    trackingLookupInFlight,
    submitTrackingScan,
  } = useTrackingScan({
    staffId,
    queryClient,
    publishPhotoRequestFor,
    serialInputRef,
    setSelectedLine,
    setScanMatchedRows,
    setLineAccordionBootstrap,
    setScanDriven,
    setPoContext,
    setArmedLineId,
    setPendingCandidates,
    receivingMode: mode,
  });

  usePhoneScanBridge({
    phoneChannelName,
    stationChannelName,
    getAblyClient,
    staffId,
    submitTrackingScan,
  });

  // Pickup mode clears the whole unbox session (PO + serial inputs + returns).
  useEffect(() => {
    if (mode === 'pickup') {
      clearScanSession();
      clearReturns();
    }
  }, [mode, clearScanSession, clearReturns]);

  // ── Rail edit mode (pencil bulk select / delete) ─────────────────────────
  const {
    railEditMode,
    railSelectedIds,
    railSelectedIdList,
    railBulkDeleting,
    toggleRailEditMode,
    toggleRailSelected,
    setManyRailSelected,
    handleRailBulkDelete,
  } = useRailEditMode({ isScanSurface, mode, unboxView, triageView });

  // ── Triage scan input (scan-only — NOT a list filter) ──
  // The station scan bar only scans; it never filters the triage list. Feeding
  // its value into the list churned the queryKey per-keystroke and briefly
  // collapsed the list to "found only" mid-scan. Searching scanned orders lives
  // in the dedicated History mode, so the triage list always shows the full
  // Found ∪ Unfound set and the bar just resolves + clears.
  const [triageQuery, setTriageQuery] = useState('');
  const scanInputRef = useRef<HTMLInputElement>(null);

  // B4 — Triage select-on-resolve. The shared `submitTrackingScan` already opens
  // the resolved carton in every mode, but its internal select is gated on the
  // scan-generation stale-guard. In TRIAGE we additionally GUARANTEE the
  // just-scanned carton drops into the detail pane by re-dispatching the same
  // `receiving-select-line` event the rail/table use — picking the first OPEN
  // line so it stays consistent with the scan's own pick (no carton→carton jump,
  // re-selecting the same carton is idempotent since the workspace is keyed on
  // receiving_id). Scoped to the triage onSubmit only; the unbox path keeps
  // relying on the internal selection. Mirrors the deep-link select pattern in
  // useReceivingWorkspacePane (fetch lines by receiving_id → dispatchSelectLine).
  const selectResolvedTriageCarton = useCallback((result: TrackingScanResult) => {
    const recvId = result.receiving_id;
    if (recvId == null || !Number.isFinite(recvId)) return;
    void (async () => {
      let pick: ReceivingLineRow | null = null;
      try {
        // Reuse the SAME hydration fetch openMatchedCarton issues: both go
        // through queryClient.fetchQuery on the ['receiving-siblings', recvId]
        // key, so the two concurrent identical requests dedupe into a single
        // /api/receiving-lines round-trip instead of double-fetching on every
        // matched triage scan. retry:false keeps the prior one-shot behavior.
        const data = await queryClient.fetchQuery({
          queryKey: ['receiving-siblings', recvId],
          queryFn: async () => {
            const r = await fetch(
              `/api/receiving-lines?receiving_id=${recvId}&include=serials`,
            );
            return r.json();
          },
          retry: false,
        });
        const rows: ReceivingLineRow[] = Array.isArray(data?.receiving_lines)
          ? (data.receiving_lines as ReceivingLineRow[])
          : [];
        const open = rows.find(
          (r) => r.quantity_expected == null || r.quantity_received < (r.quantity_expected ?? 0),
        );
        pick = open ?? rows[0] ?? null;
      } catch {
        /* fall through to the unmatched stub so we never clear the selection */
      }
      // Never dispatch null (that would clear the carton the scan just opened) —
      // a brand-new unmatched carton with no lines yet falls back to the same
      // synthetic stub submitTrackingScan uses.
      if (!pick) pick = buildUnmatchedStubRow(recvId, result.tracking);
      dispatchSelectLine(pick);
    })();
  }, [queryClient]);

  // External focus trigger — Quick Access chips dispatch `receiving-focus-scan`
  // after navigating so the input is hot even when the panel was already mounted.
  // Select any existing text so the operator can immediately overwrite it with
  // the next scan (barcode guns type-then-Enter, so a selected field is "armed").
  useEffect(() => {
    const handler = () =>
      requestAnimationFrame(() => {
        const el = scanInputRef.current;
        if (!el) return;
        el.focus();
        el.select();
      });
    window.addEventListener('receiving-focus-scan', handler);
    return () => window.removeEventListener('receiving-focus-scan', handler);
  }, []);

  // The focus-scan quick-key is now the app-wide shared hotkey (default F2,
  // reassignable via the gear in any StationScanBar). The unbox/triage bars
  // register themselves as the focus target through StationScanBar, so the key
  // snaps focus here with no receiving-specific handler. The
  // `receiving-focus-scan` listener above remains for the Quick Access chips.

  return (
    // `relative` anchors the edit-mode SelectionActionBar pinned at the bottom.
    <div className="relative flex h-full min-w-0 flex-col overflow-hidden">
      <RailEditModeProvider
        active={railEditMode && isScanSurface}
        selectedIds={railSelectedIds}
        toggle={toggleRailSelected}
        setMany={setManyRailSelected}
        toggleActive={toggleRailEditMode}
      >
        {!masterNavEnabled && <ReceivingModeSwitcher mode={mode} onChange={updateMode} />}

        {mode === 'pickup' ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <LocalPickupSidebarList />
          </div>
        ) : mode === 'incoming' ? (
          // Incoming = Zoho-sourced expected work. Sidebar owns the search +
          // facet controls; the right-pane table renders the rows only.
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <IncomingSidebarPanel />
          </div>
        ) : (
          <>
            {mode === 'history' ? (
              <ReceivingHistorySearchSection onSwitchToReceiving={() => updateMode('receive')} />
            ) : mode === 'triage' ? (
              // Triage is a scan surface: a tracking-only entry wired to the same
              // submitTrackingScan → lookup-po flow. Scan-only — the input never
              // filters the list (that's History mode); it just resolves + clears.
              <TriageScanBand
                themeColor={themeColor}
                value={triageQuery}
                onChange={setTriageQuery}
                onSubmit={() => {
                  const tracking = triageQuery.trim();
                  // Optimistic "importing" skeleton: announce the scan so the
                  // triage list shows a placeholder row INSTANTLY (no right-pane
                  // takeover loader); TriageSidebarBody reconciles it in place on
                  // resolve. The clientEventId is the row's DURABLE identity — the
                  // stub and the resolved row key by it, so the swap is an in-place
                  // update (no disappear-then-reappear flicker), not a remount.
                  if (tracking) {
                    window.dispatchEvent(
                      new CustomEvent('receiving-scan-importing', {
                        detail: { tracking, clientEventId: safeRandomUUID() },
                      }),
                    );
                  }
                  submitTrackingScan(triageQuery, {
                    mode: 'tracking',
                    onResult: selectResolvedTriageCarton,
                  });
                  setTriageQuery('');
                }}
                inputRef={scanInputRef}
                inputBorderClassName={inputBorder}
                isResolving={trackingLookupInFlight > 0}
              />
            ) : (
              <UnboxScanBand
                themeColor={themeColor}
                value={bulkTracking}
                onChange={setBulkTracking}
                onSubmit={(m) => {
                  // Unbox: one cache upsert on resolve (final title). No importing
                  // stub — that caused tracking# → Unfound PO flicker.
                  if (unboxView === 'queue') updateUnboxView('recent', { clearLine: false });
                  submitTrackingScan(undefined, { mode: m });
                }}
                inputRef={scanInputRef}
                isResolving={trackingLookupInFlight > 0}
                staffId={staffId}
                armedMode={unboxScanMode}
                onToggleMode={(m) => setUnboxScanMode((prev) => (prev === m ? null : m))}
              />
            )}

            <ReceivingReturnBanner returns={returns} onDismiss={dismissReturn} />

            {/* Pinned sub-view toggles — outside the rail scroll body so pill
                shadows and row entrance motion are not clipped by overflow. */}
            {isScanSurface && mode === 'receive' ? (
              <UnboxViewToggle value={unboxView} onChange={updateUnboxView} />
            ) : null}
            {isScanSurface && mode === 'triage' ? (
              <TriageViewToggle value={triageView} onChange={updateTriageView} />
            ) : null}

            {/* Multi-match picker — pinned above the rail so it stays visible. */}
            {scanDriven && !selectedLine && scanMatchedRows.length > 1 ? (
              <ReceivingLinePicker
                rows={scanMatchedRows}
                onPick={(line) => {
                  setLineAccordionBootstrap('default');
                  setSelectedLine(line);
                }}
                onCancel={() => {
                  setScanDriven(false);
                  setScanMatchedRows([]);
                  clearScanSession();
                }}
              />
            ) : null}

            {/* Rail only — matches TestingSidebarPanel: vertical scroll, no
                horizontal clip from overflow-auto. */}
            {isScanSurface ? (
              <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
                <ReceivingRailBody
                  mode={mode}
                  unboxView={unboxView}
                  selectedLine={selectedLine}
                  triageFilterText=""
                />
              </div>
            ) : null}
          </>
        )}

        {/* Edit-mode bulk actions — auto-shows while rows are checked. */}
        {isScanSurface && railEditMode ? (
          <ReceivingBulkActionBar
            selectedIds={railSelectedIdList}
            onDelete={handleRailBulkDelete}
            busy={railBulkDeleting}
          />
        ) : null}
      </RailEditModeProvider>
    </div>
  );
}
