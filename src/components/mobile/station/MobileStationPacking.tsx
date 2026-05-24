'use client';

import React, { useRef, useState, useCallback, useReducer, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  framerPresenceMobile,
  framerTransitionMobile,
} from '@/design-system/foundations/motion-framer';
import { Barcode, AlertCircle, Package, Loader2, Check } from '@/components/Icons';
import { useStationTheme } from '@/hooks/useStationTheme';
import { useLast8TrackingSearch } from '@/hooks/useLast8TrackingSearch';
import { formatPSTTimestamp } from '@/utils/date';
import StationGoalBar from '@/components/station/StationGoalBar';
import { detectStationScanType } from '@/lib/station-scan-routing';
import type { StationScanType } from '@/lib/station-scan-routing';
import { cn } from '@/utils/_cn';
import { MobileShell, type MobileShellProps } from '@/design-system/components/mobile/MobileShell';
import { MobileBoxedNavChevron } from '@/design-system/components/mobile';
import { MobileBottomActionBar } from '@/design-system/components/mobile/MobileBottomActionBar';
import { MobilePackerScanSheet } from './MobilePackerScanSheet';
import { MobileQueueFilterSheet } from '@/components/mobile/overlays/MobileQueueFilterSheet';
import { SLIDER_PRESETS, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { MobilePackingConfirmCard } from './MobilePackingConfirmCard';
import { MobilePackingPhotoStep } from './MobilePackingPhotoStep';
import { MobilePackingReviewStep } from './MobilePackingReviewStep';
import { MobileLastOrderCard } from './MobileLastOrderCard';
import { requestCameraPermission } from '@/hooks/useCamera';
import {
  wizardReducer,
  initialWizardState,
  type CapturedPhoto,
  type ActivePackingOrder,
  type ActiveFbaScan,
} from '@/hooks/station/packingWizardReducer';
import { useMobilePackingLookup } from '@/hooks/station/useMobilePackingLookup';
import { useAblyClient } from '@/contexts/AblyContext';
import { NetworkChip } from '@/components/mobile/NetworkChip';
import { MobileSettingsButton } from '@/components/mobile/MobileSettingsButton';

// Re-export types for consumers (e.g. MobilePackingConfirmCard)
export type { ActivePackingOrder, ActiveFbaScan, CapturedPhoto } from '@/hooks/station/packingWizardReducer';

// ─── Props ──────────────────────────────────────────────────────────────────

interface MobileStationPackingProps {
  userId: string;
  userName: string;
  staffId: number | string;
  todayCount: number;
  goal?: number;
  onComplete?: () => void;
  /** Override the MobileShell toolbar (e.g. from MobilePackerDashboard for arrow nav). */
  toolbar?: MobileShellProps['toolbar'];
  /** When true, no MobileShell top bar on scan/lookup — parent provides {@link MobilePageHeader} (packer mobile). */
  suppressShellToolbar?: boolean;
  /** When true, hides the bottom search + camera dock (packer mobile full-bleed content). */
  suppressBottomActionBar?: boolean;
  /** Fills parent flex region (e.g. `min-h-0 flex-1 h-full`). */
  shellClassName?: string;
}

// ─── Animation ──────────────────────────────────────────────────────────────

const MOBILE_EASE = [0.22, 1, 0.36, 1] as const;
const mobileTween = { duration: 0.24, ease: MOBILE_EASE };

// ─── Component ──────────────────────────────────────────────────────────────

export function MobileStationPacking({
  userId,
  userName,
  staffId,
  todayCount = 0,
  goal = 50,
  onComplete,
  toolbar: externalToolbar,
  suppressShellToolbar = false,
  suppressBottomActionBar = false,
  shellClassName,
}: MobileStationPackingProps) {
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);
  // Snapshot of latest wizard state for use inside the Ably subscription
  // callback, which would otherwise close over stale state.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  // Transient toast for mid-flow scan acknowledgments. `null` when idle.
  const [scanToast, setScanToast] = useState<{ id: number; message: string } | null>(null);
  const knownPreviewUrlsRef = useRef<Set<string>>(new Set());
  const [inputValue, setInputValue] = useState('');
  const [scanSheetOpen, setScanSheetOpen] = useState(false);
  const [lastOrderRefreshKey, setLastOrderRefreshKey] = useState(0);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [queueFilterSheetOpen, setQueueFilterSheetOpen] = useState(false);
  const [packQueueSearch, setPackQueueSearch] = useState('');
  const [packQuickFilter, setPackQuickFilter] = useState('must_go');
  const [packFilterItems] = useState<HorizontalSliderItem[]>([
    SLIDER_PRESETS.mustGo,
    SLIDER_PRESETS.newest,
    SLIDER_PRESETS.oldest,
  ]);
  const [packFilterVariant] = useState<'fba' | 'slate'>('fba');
  const inputRef = useRef<HTMLInputElement>(null);

  const { theme: themeColor } = useStationTheme({ staffId });
  const { normalizeTracking } = useLast8TrackingSearch();
  const { handleLookup } = useMobilePackingLookup({ userId, userName, normalizeTracking, dispatch });
  const { getClient: getAblyClient } = useAblyClient();
  // Mirror getAblyClient into a ref so the publish-state effect doesn't need
  // to list it as a dep (its identity is now stable per AblyContext fix, but
  // the ref pattern keeps the effect resilient to any future provider change).
  const getAblyClientRef = useRef(getAblyClient);
  useEffect(() => { getAblyClientRef.current = getAblyClient; }, [getAblyClient]);

  // ── Broadcast wizard transitions to packer:{staffId} ───────────────────────
  // Paired desktop displays subscribe to mirror the phone's current state.
  //
  // Two safeguards keep this well under Ably's 50 msg/sec per-channel cap:
  //   1. Dependency array uses only the *primitive* fields that matter for the
  //      paired display. Object refs like `state.resolvedOrder` would mint a
  //      new effect run on every reducer dispatch even when nothing actually
  //      changed for the broadcast — that's how this loop fanned out to 1000+
  //      publishes/sec when combined with cascading parent re-renders.
  //   2. Coalesce + lastPayloadRef de-dupe: if multiple state changes land in
  //      the same tick, we publish once with the latest payload, and only if
  //      the JSON-serialised payload actually differs from the previous send.
  const lastPayloadRef = useRef<string>('');
  const publishTimerRef = useRef<number | null>(null);
  const orderId = state.resolvedOrder?.orderId ?? null;
  const fnsku = state.resolvedFba?.fnsku ?? null;
  const photoCount = state.capturedPhotos.length;
  useEffect(() => {
    if (publishTimerRef.current != null) return;
    publishTimerRef.current = window.setTimeout(() => {
      publishTimerRef.current = null;

      const cur = stateRef.current;
      const orderSummary = cur.resolvedOrder
        ? {
            orderId: cur.resolvedOrder.orderId,
            productTitle: cur.resolvedOrder.productTitle,
            tracking: cur.resolvedOrder.tracking,
            qty: cur.resolvedOrder.qty,
            condition: cur.resolvedOrder.condition,
            shipByDate: cur.resolvedOrder.shipByDate,
          }
        : cur.resolvedFba
          ? {
              fnsku: cur.resolvedFba.fnsku,
              productTitle: cur.resolvedFba.productTitle,
              shipmentRef: cur.resolvedFba.shipmentRef,
              plannedQty: cur.resolvedFba.plannedQty,
            }
          : null;

      const payload = {
        step: cur.step,
        variant: cur.orderVariant,
        scannedValue: cur.scannedValue,
        orderSummary,
        photoCount: cur.capturedPhotos.length,
      };
      const serialised = JSON.stringify(payload);
      if (serialised === lastPayloadRef.current) return;
      lastPayloadRef.current = serialised;

      void getAblyClientRef.current().then((client) => {
        if (!client) return;
        try {
          const ch = client.channels.get(`packer:${staffId}`);
          ch.publish('state', { ...payload, ts: Date.now() }).catch(() => {
            // best-effort; broadcast failure is non-fatal to the packer flow
          });
        } catch {
          // best-effort
        }
      });
    }, 120);
    return () => {
      if (publishTimerRef.current != null) {
        window.clearTimeout(publishTimerRef.current);
        publishTimerRef.current = null;
      }
    };
  }, [
    state.step,
    state.orderVariant,
    state.scannedValue,
    orderId,
    fnsku,
    photoCount,
    staffId,
  ]);

  // ── Manual input submit (typed/pasted tracking) ────────────────────────────

  const handleManualSubmit = useCallback(async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    const scan = inputValue.trim();
    if (!scan || state.isLoading) return;
    setInputValue('');
    await handleLookup(scan, detectStationScanType(scan));
  }, [inputValue, state.isLoading, handleLookup]);

  // ── Packer scan sheet confirmed (lookup + confirm handled inline) ────────

  const handlePackerScanConfirmed = useCallback(
    (result: {
      order: import('@/hooks/station/packingWizardReducer').ActivePackingOrder | null;
      fba: import('@/hooks/station/packingWizardReducer').ActiveFbaScan | null;
      variant: import('@/hooks/station/packingWizardReducer').OrderVariant;
      packerLogId: number | null;
      scanType: string;
      scannedValue: string;
    }) => {
      setScanSheetOpen(false);
      dispatch({
        type: 'SCAN_SHEET_ORDER_CONFIRMED',
        order: result.order,
        fba: result.fba,
        variant: result.variant,
        packerLogId: result.packerLogId,
        scanType: result.scanType,
        scannedValue: result.scannedValue,
      });
    },
    [],
  );

  const handleOpenScanSheet = useCallback(() => {
    void requestCameraPermission().finally(() => {
      setScanSheetOpen(true);
    });
  }, []);

  // Global mobile FAB delegates to the packer scan sheet on /packer.
  useEffect(() => {
    const h = () => handleOpenScanSheet();
    window.addEventListener('mobile-scan-fab-open', h);
    return () => window.removeEventListener('mobile-scan-fab-open', h);
  }, [handleOpenScanSheet]);

  // ── Subscribe to desktop-originated packer scans ───────────────────────────
  // When the desktop (PackerSidebarPanel / StationPacking) scans a tracking
  // number and writes packer_logs, the API publishes `scan_ready` on
  // packer:{staffId}. We land on the confirm step here ("Ready to pack?").
  useEffect(() => {
    const channelName = `packer:${staffId}`;
    let channelRef: any = null;
    let listener: any = null;
    let cancelled = false;

    void getAblyClient().then((client) => {
      if (cancelled || !client) return;
      try {
        const ch = client.channels.get(channelName);
        channelRef = ch;
        listener = (msg: any) => {
          const data = msg?.data || {};
          if (!data || data.type !== 'packer.scan_ready') return;

          // Mid-flow: the packer is capturing/reviewing photos. We never
          // eject them — the reducer would no-op anyway. If the new scan is
          // for the SAME orderId, treat it as additive (photos stay grouped
          // under that order — no UI change). Different orderId gets a
          // non-blocking toast so the desktop scanner feels acknowledged.
          const cur = stateRef.current;
          const inFlow = cur.step === 'photos' || cur.step === 'review';
          if (inFlow) {
            const incomingOrderId = data.order?.orderId ?? null;
            const currentOrderId = cur.resolvedOrder?.orderId ?? null;
            const sameOrder = !!incomingOrderId && incomingOrderId === currentOrderId;
            if (!sameOrder) {
              setScanToast({
                id: Date.now(),
                message: 'New order scanned — finish this one first',
              });
            }
            return;
          }

          dispatch({
            type: 'REMOTE_SCAN_READY',
            order: data.order ?? null,
            fba: data.fba ?? null,
            variant: data.variant || 'order',
            packerLogId: data.packerLogId ?? null,
            scanType: data.trackingType || 'ORDERS',
            scannedValue: data.scannedValue || '',
          });
        };
        ch.subscribe('scan_ready', listener);
      } catch {
        // best-effort; absent realtime should not break the wizard
      }
    });

    return () => {
      cancelled = true;
      try {
        if (channelRef && listener) channelRef.unsubscribe('scan_ready', listener);
      } catch {}
    };
  }, [staffId, getAblyClient]);

  // ── Auto-dismiss mid-flow scan toast after ~3.2s ──────────────────────────
  useEffect(() => {
    if (!scanToast) return;
    const t = setTimeout(() => setScanToast(null), 3200);
    return () => clearTimeout(t);
  }, [scanToast]);

  // ── Revoke stale preview URLs ──────────────────────────────────────────────
  // After every render, any object URL that was known previously but is no
  // longer in capturedPhotos (RESET, PHOTO_REMOVED, batch replace) is freed.
  // Also revokes the whole set on unmount.
  useEffect(() => {
    const known = knownPreviewUrlsRef.current;
    const current = new Set(state.capturedPhotos.map((p) => p.previewUrl));
    for (const url of known) {
      if (!current.has(url)) {
        URL.revokeObjectURL(url);
        known.delete(url);
      }
    }
    for (const url of current) known.add(url);
  }, [state.capturedPhotos]);

  useEffect(() => {
    const known = knownPreviewUrlsRef.current;
    return () => {
      for (const url of known) URL.revokeObjectURL(url);
      known.clear();
    };
  }, []);

  // ── Step 4: Photos captured (batch) ────────────────────────────────────────

  const handlePhotosBatched = useCallback((photos: CapturedPhoto[]) => {
    dispatch({ type: 'CAPTURE_PHOTOS_BATCH', photos });
  }, []);

  const handlePhotoRemoved = useCallback((id: string) => {
    dispatch({ type: 'PHOTO_REMOVED', id });
  }, []);

  const handlePhotoStatus = useCallback(
    (update: {
      id: string;
      status: import('@/hooks/station/packingWizardReducer').PhotoUploadStatus;
      serverPath?: string | null;
      photoId?: number | null;
      errorMessage?: string | null;
    }) => {
      dispatch({ type: 'UPLOAD_PHOTO_STATUS', ...update });
    },
    [],
  );

  // ── Step 5: Complete packing ───────────────────────────────────────────────

  const handleComplete = useCallback(async () => {
    dispatch({ type: 'COMPLETE_START' });

    try {
      const tracking = state.resolvedOrder?.tracking || state.resolvedFba?.fnsku || state.scannedValue || '';
      const trackingType = state.resolvedScanType || 'ORDERS';
      const orderId = state.resolvedOrder?.orderId || '';

      const res = await fetch('/api/packing-logs/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shippingTrackingNumber: tracking,
          trackingType,
          packDateTime: formatPSTTimestamp(),
          packedBy: userId,
          packerPhotosUrl: state.capturedPhotos
            .map(p => p.serverPath)
            .filter((u): u is string => !!u),
          orderId,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        dispatch({ type: 'COMPLETE_ERROR', message: data?.error || 'Failed to complete packing' });
        return;
      }

      dispatch({ type: 'COMPLETE_SUCCESS' });
      onComplete?.();
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch (err: any) {
      dispatch({ type: 'COMPLETE_ERROR', message: err?.message || 'Failed to complete' });
    }
  }, [state, userId, onComplete]);

  // ── Auto-finalize once every photo is uploaded ────────────────────────────
  // Lives at the parent (not Review) so the completion POST fires even if
  // the packer back-nav's to the photo step before uploads finish. Keyed by
  // packerLogId in a ref Set so it can only fire once per session — manual
  // "Done" still works (server-side dedup at /api/packing-logs/update keeps
  // duplicate inserts and inventory ledger writes from doubling up).
  const finalizedSessionsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const pid = state.packerLogId;
    if (!pid) return;
    if (state.isLoading) return;
    if (state.step === 'success' || state.step === 'scan') return;
    if (finalizedSessionsRef.current.has(pid)) return;
    if (state.capturedPhotos.length === 0) return;
    const allUploaded = state.capturedPhotos.every((p) => p.uploadStatus === 'uploaded');
    if (!allUploaded) return;
    finalizedSessionsRef.current.add(pid);
    void handleComplete();
  }, [
    state.packerLogId,
    state.capturedPhotos,
    state.isLoading,
    state.step,
    handleComplete,
  ]);

  // ── Success auto-reset ─────────────────────────────────────────────────────

  const handleSuccessFinished = useCallback(() => {
    dispatch({ type: 'RESET' });
    setLastOrderRefreshKey((k) => k + 1);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // Auto-advance from success after 2.5s
  useEffect(() => {
    if (state.step !== 'success') return;
    const timer = setTimeout(handleSuccessFinished, 2500);
    return () => clearTimeout(timer);
  }, [state.step, handleSuccessFinished]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const showBottomBar = state.step === 'scan' && !suppressBottomActionBar;

  const noTopShellToolbar =
    suppressShellToolbar && (state.step === 'scan' || state.step === 'lookup');

  const toolbarConfig: MobileShellProps['toolbar'] =
    noTopShellToolbar
      ? false
      : (state.step === 'scan' || state.step === 'lookup') && externalToolbar
        ? externalToolbar
        : {
            title: state.step === 'scan'
              ? `Welcome, ${userName}`
              : state.step === 'lookup'
                ? 'Looking up order...'
                : state.step === 'confirm'
                  ? 'Confirm Order'
                  : state.step === 'photos'
                    ? `Photos (${state.capturedPhotos.length})`
                    : state.step === 'review'
                      ? 'Review & Complete'
                      : 'Done!',
            leading: state.step !== 'scan' && state.step !== 'lookup' && state.step !== 'success' ? (
              <MobileBoxedNavChevron
                direction="left"
                onClick={() => dispatch({ type: 'BACK' })}
              />
            ) : undefined,
            trailing: (
              <div className="flex items-center gap-2">
                <NetworkChip compact />
                <MobileSettingsButton />
                <span className="text-caption font-black text-gray-500 tabular-nums">
                  {todayCount}/{goal}
                </span>
                <div className="p-2 bg-gray-900 text-white rounded-xl">
                  <Package className="w-3.5 h-3.5" />
                </div>
              </div>
            ),
          };

  return (
    <>
      <MobileShell
        className={cn(shellClassName)}
        toolbar={toolbarConfig}
        bottomDockVariant={showBottomBar ? 'overlay' : undefined}
        bottomDock={showBottomBar ? (
          <MobileBottomActionBar
            chrome="ghost"
            searchValue={inputValue}
            onSearchChange={setInputValue}
            onSearchSubmit={handleManualSubmit}
            searchPlaceholder="Scan Tracking, FNSKU, or SKU..."
            searchExpanded={searchExpanded}
            onSearchExpandedChange={setSearchExpanded}
            searchInputRef={inputRef}
            searchIcon={<Barcode className="h-[17px] w-[17px] text-gray-600" />}
            onQueueFilterPress={() => setQueueFilterSheetOpen(true)}
            showInlineFilterButton={false}
            onScanPress={handleOpenScanSheet}
            isLoading={state.isLoading}
            themeColor={themeColor}
          />
        ) : undefined}
      >
        <div className="px-3 pt-2 pb-4 flex flex-col min-h-full">
          <AnimatePresence mode="wait">
            {/* ── STEP: SCAN (idle) ── */}
            {state.step === 'scan' && (
              <motion.div
                key="step-scan"
                initial={framerPresenceMobile.mobileCard.initial}
                animate={framerPresenceMobile.mobileCard.animate}
                exit={framerPresenceMobile.mobileCard.exit}
                transition={framerTransitionMobile.mobileCardMount}
                className="space-y-3"
              >
                <StationGoalBar
                  count={todayCount}
                  goal={goal}
                  label="PACKED"
                  theme={themeColor}
                />

                {/* Last packed order — quick review + photo edit */}
                <MobileLastOrderCard
                  packerId={userId}
                  refreshKey={lastOrderRefreshKey}
                />

                {/* Error banner from previous attempt */}
                {state.errorMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={mobileTween}
                    className="p-3 bg-red-50 text-red-700 rounded-2xl border border-red-200 flex items-center gap-3"
                  >
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    <p className="text-xs font-bold">{state.errorMessage}</p>
                  </motion.div>
                )}

                {/* Empty state prompt */}
                <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                    <Barcode className="w-7 h-7 text-gray-400" />
                  </div>
                  <p className="text-sm font-bold text-gray-500">Scan a tracking number to start</p>
                  {!suppressBottomActionBar && (
                    <p className="text-caption text-gray-400 mt-1">
                      Use the camera button or type below
                    </p>
                  )}
                </div>

                <div className="pt-4 border-t border-gray-50 text-center">
                  <p className="text-xs font-black text-gray-300 uppercase tracking-[0.3em]">USAV PACK MOBILE v2.0</p>
                </div>
              </motion.div>
            )}

            {/* ── STEP: LOOKUP (loading) ── */}
            {state.step === 'lookup' && (
              <motion.div
                key="step-lookup"
                initial={framerPresenceMobile.mobileCard.initial}
                animate={framerPresenceMobile.mobileCard.animate}
                exit={framerPresenceMobile.mobileCard.exit}
                transition={framerTransitionMobile.mobileCardMount}
                className="flex-1 flex flex-col items-center justify-center py-16"
              >
                <Loader2 className="w-8 h-8 text-gray-400 animate-spin mb-4" />
                <p className="text-sm font-bold text-gray-600">Looking up order...</p>
                {state.scannedValue && (
                  <p className="text-caption font-mono text-gray-400 mt-2 break-all px-4 text-center">
                    {state.scannedValue}
                  </p>
                )}
              </motion.div>
            )}

            {/* ── STEP: CONFIRM ── */}
            {state.step === 'confirm' && (
              <motion.div
                key="step-confirm"
                initial={framerPresenceMobile.mobileCard.initial}
                animate={framerPresenceMobile.mobileCard.animate}
                exit={framerPresenceMobile.mobileCard.exit}
                transition={framerTransitionMobile.mobileCardMount}
                className="space-y-3"
              >
                <MobilePackingConfirmCard
                  order={state.resolvedOrder}
                  fba={state.resolvedFba}
                  variant={state.orderVariant}
                  scannedValue={state.scannedValue || ''}
                  onConfirm={() => dispatch({ type: 'CONFIRM_YES' })}
                  onReject={() => dispatch({ type: 'CONFIRM_NO' })}
                />
              </motion.div>
            )}

            {/* ── STEP: PHOTOS ── */}
            {state.step === 'photos' && (
              <motion.div
                key="step-photos"
                initial={framerPresenceMobile.mobileCard.initial}
                animate={framerPresenceMobile.mobileCard.animate}
                exit={framerPresenceMobile.mobileCard.exit}
                transition={framerTransitionMobile.mobileCardMount}
              >
                <MobilePackingPhotoStep
                  orderId={state.resolvedOrder?.orderId || state.resolvedFba?.fnsku || ''}
                  packerId={userId}
                  packerLogId={state.packerLogId}
                  photos={state.capturedPhotos}
                  productTitle={
                    state.resolvedOrder?.productTitle
                      || state.resolvedFba?.productTitle
                      || null
                  }
                  onPhotosBatched={handlePhotosBatched}
                  onBack={() => dispatch({ type: 'RESET' })}
                />
              </motion.div>
            )}

            {/* ── STEP: REVIEW ── */}
            {state.step === 'review' && (
              <motion.div
                key="step-review"
                initial={framerPresenceMobile.mobileCard.initial}
                animate={framerPresenceMobile.mobileCard.animate}
                exit={framerPresenceMobile.mobileCard.exit}
                transition={framerTransitionMobile.mobileCardMount}
              >
                <MobilePackingReviewStep
                  order={state.resolvedOrder}
                  fba={state.resolvedFba}
                  variant={state.orderVariant}
                  photos={state.capturedPhotos}
                  packerId={userId}
                  packerLogId={state.packerLogId}
                  isCompleting={state.isLoading}
                  errorMessage={state.errorMessage}
                  onPhotoStatus={handlePhotoStatus}
                  onPhotoRemoved={handlePhotoRemoved}
                  onComplete={handleComplete}
                  onBack={() => dispatch({ type: 'BACK' })}
                />
              </motion.div>
            )}

            {/* ── STEP: SUCCESS ── */}
            {state.step === 'success' && (
              <motion.div
                key="step-success"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3, ease: MOBILE_EASE }}
                className="flex-1 flex flex-col items-center justify-center py-16"
              >
                <motion.div
                  initial={{ scale: 0.5 }}
                  animate={{ scale: [0.5, 1.15, 1] }}
                  transition={{ duration: 0.5, ease: MOBILE_EASE }}
                  className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mb-5"
                >
                  <Check className="w-10 h-10 text-emerald-600" />
                </motion.div>
                <p className="text-lg font-black text-gray-900">Packing Complete!</p>
                <p className="text-sm text-gray-500 mt-1">
                  {state.resolvedOrder?.productTitle || state.resolvedFba?.productTitle || 'Order packed'}
                </p>
                <button
                  type="button"
                  onClick={handleSuccessFinished}
                  className="mt-8 h-[52px] px-8 rounded-2xl bg-gray-900 text-white text-label font-black uppercase tracking-wider active:bg-gray-800 transition-colors"
                >
                  Scan Next
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </MobileShell>

      <MobileQueueFilterSheet
        isOpen={queueFilterSheetOpen}
        onClose={() => setQueueFilterSheetOpen(false)}
        title="Filter queue"
        quickFilter={packQuickFilter}
        onQuickFilterChange={setPackQuickFilter}
        quickFilterItems={packFilterItems}
        quickFilterVariant={packFilterVariant}
        searchText={packQueueSearch}
        onSearchChange={setPackQueueSearch}
        placeholder="Search recent activity…"
      />

      {/* ── Packer scan sheet (scan + lookup + confirm in one flow) ── */}
      <MobilePackerScanSheet
        isOpen={scanSheetOpen}
        onClose={() => setScanSheetOpen(false)}
        onConfirmed={handlePackerScanConfirmed}
        userId={userId}
        userName={userName}
      />

      {/* ── Mid-flow scan toast ── pinned just above safe-area-bottom so the
          packer sees the desktop scanner was acknowledged without being
          yanked out of the current order. */}
      <AnimatePresence>
        {scanToast && (
          <motion.div
            key={scanToast.id}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={mobileTween}
            className="fixed inset-x-4 z-[150] flex items-center gap-2 rounded-2xl bg-gray-900 px-4 py-3 text-white shadow-xl"
            style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}
            role="status"
          >
            <Barcode className="h-4 w-4 flex-shrink-0 text-white/80" />
            <p className="text-label font-bold flex-1">{scanToast.message}</p>
            <button
              type="button"
              onClick={() => setScanToast(null)}
              className="text-caption font-black uppercase tracking-wider text-white/70 active:text-white"
              aria-label="Dismiss"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
