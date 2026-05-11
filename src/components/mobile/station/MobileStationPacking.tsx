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
  shellClassName,
}: MobileStationPackingProps) {
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);
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

  // ── Broadcast wizard transitions to packer:{staffId} ───────────────────────
  // Paired desktop displays subscribe to mirror the phone's current state.
  useEffect(() => {
    const channelName = `packer:${staffId}`;
    const orderSummary = state.resolvedOrder
      ? {
          orderId: state.resolvedOrder.orderId,
          productTitle: state.resolvedOrder.productTitle,
          tracking: state.resolvedOrder.tracking,
          qty: state.resolvedOrder.qty,
          condition: state.resolvedOrder.condition,
          shipByDate: state.resolvedOrder.shipByDate,
        }
      : state.resolvedFba
        ? {
            fnsku: state.resolvedFba.fnsku,
            productTitle: state.resolvedFba.productTitle,
            shipmentRef: state.resolvedFba.shipmentRef,
            plannedQty: state.resolvedFba.plannedQty,
          }
        : null;

    const payload = {
      step: state.step,
      variant: state.orderVariant,
      scannedValue: state.scannedValue,
      orderSummary,
      photoCount: state.capturedPhotos.length,
      ts: Date.now(),
    };

    let cancelled = false;
    void getAblyClient().then((client) => {
      if (cancelled || !client) return;
      try {
        const ch = client.channels.get(channelName);
        ch.publish('state', payload).catch(() => {
          // best-effort; broadcast failure is non-fatal to the packer flow
        });
      } catch {
        // best-effort
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    state.step,
    state.orderVariant,
    state.scannedValue,
    state.resolvedOrder,
    state.resolvedFba,
    state.capturedPhotos.length,
    staffId,
    getAblyClient,
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

  const showBottomBar = state.step === 'scan';

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
                <span className="text-[11px] font-black text-gray-500 tabular-nums">
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
                  staffId={staffId}
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
                  <p className="text-[11px] text-gray-400 mt-1">
                    Use the camera button or type below
                  </p>
                </div>

                <div className="pt-4 border-t border-gray-50 text-center">
                  <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.3em]">USAV PACK MOBILE v2.0</p>
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
                  <p className="text-[11px] font-mono text-gray-400 mt-2 break-all px-4 text-center">
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
                  onPhotosBatched={handlePhotosBatched}
                  onBack={() => dispatch({ type: 'BACK' })}
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
                  className="mt-8 h-[52px] px-8 rounded-2xl bg-gray-900 text-white text-[12px] font-black uppercase tracking-wider active:bg-gray-800 transition-colors"
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
    </>
  );
}
