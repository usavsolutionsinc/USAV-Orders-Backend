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
import { ReceivingReturnBanner } from '@/components/sidebar/ReceivingReturnBanner';
import { ReceivingHistorySearchSection } from '@/components/sidebar/receiving/ReceivingHistorySearchSection';
import { ReceivingLinePicker } from '@/components/sidebar/receiving/ReceivingLinePicker';
import { IncomingSidebarPanel } from '@/components/sidebar/receiving/IncomingSidebarPanel';
import { LocalPickupSidebarList } from '@/components/work-orders/LocalPickupSidebarList';

import { ReceivingModeSwitcher } from '@/components/sidebar/receiving/ReceivingModeSwitcher';
import { TriageScanBand, UnboxScanBand } from '@/components/sidebar/receiving/ReceivingScanBands';
import { UnboxViewToggle } from '@/components/sidebar/receiving/UnboxViewToggle';
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
  const { mode, unboxView, triageView, isScanSurface, updateMode, updateUnboxView } =
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

  // ── Triage scan/filter input (doubles as the Found/Unfound rail filter) ──
  const [triageQuery, setTriageQuery] = useState('');
  const scanInputRef = useRef<HTMLInputElement>(null);

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
    <div className="relative h-full flex flex-col overflow-hidden">
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
              // Triage is a scan surface too: a tracking-only entry wired to the
              // same submitTrackingScan → lookup-po flow. The input doubles as
              // the live Found/Unfound filter; submit clears it so the resolved
              // line is visible instead of filtered out.
              <TriageScanBand
                themeColor={themeColor}
                value={triageQuery}
                onChange={setTriageQuery}
                onSubmit={() => {
                  submitTrackingScan(triageQuery, { mode: 'tracking' });
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
                  // A scan's result lands in the Recent feed — flip the rail off
                  // Queue first so the scanned carton is visible the moment it
                  // selects (the selection pin surfaces it at the top).
                  if (unboxView === 'queue') updateUnboxView('recent');
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

            {/* Scrollable body — sub-view toggle + multi-match picker + rail.
                The editor lives in the right pane. */}
            <div className="min-h-0 flex-1 overflow-auto">
              {mode === 'receive' && (
                <UnboxViewToggle value={unboxView} onChange={updateUnboxView} />
              )}

              {/* Per-staff / per-SKU narrowing now lives on the History page
                  (cleaner there); the live unbox / triage rails stay all-staff. */}

              {/* Multi-match picker — shown when a tracking scan resolves to >1
                  open lines and the user hasn't picked one. */}
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
                    clearScanSession();
                  }}
                />
              )}

              <ReceivingRailBody
                mode={mode}
                unboxView={unboxView}
                selectedLine={selectedLine}
                triageFilterText={triageQuery}
              />
            </div>
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
