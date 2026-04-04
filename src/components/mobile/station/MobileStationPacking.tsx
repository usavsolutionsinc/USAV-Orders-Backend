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
import { looksLikeFnsku } from '@/lib/scan-resolver';
import { detectStationScanType } from '@/lib/station-scan-routing';
import type { StationScanType } from '@/lib/station-scan-routing';
import { cn } from '@/utils/_cn';
import { MobileShell, type MobileShellProps } from '@/design-system/components/mobile/MobileShell';
import { MobileBoxedNavChevron } from '@/design-system/components/mobile';
import { MobileBottomActionBar } from '@/design-system/components/mobile/MobileBottomActionBar';
import { MobileScanSheet } from '@/design-system/components/mobile/MobileScanSheet';
import { MobileQueueFilterSheet } from '@/components/mobile/overlays/MobileQueueFilterSheet';
import { SLIDER_PRESETS, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { MobilePackingConfirmCard } from './MobilePackingConfirmCard';
import { MobilePackingPhotoStep } from './MobilePackingPhotoStep';
import { MobilePackingReviewStep } from './MobilePackingReviewStep';
import { requestCameraPermission } from '@/hooks/useCamera';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ActivePackingOrder {
  orderId: string;
  productTitle: string;
  qty: number;
  condition: string;
  tracking: string;
  sku?: string;
  itemNumber?: string;
  shipByDate?: string;
  createdAt?: string;
}

export interface ActiveFbaScan {
  fnsku: string;
  productTitle: string;
  shipmentRef: string | null;
  plannedQty: number;
  combinedPackScannedQty: number;
  isNew: boolean;
}

export interface CapturedPhoto {
  previewUrl: string;
  blobUrl: string;
  photoId: number | null;
  index: number;
}

type PackingWizardStep = 'scan' | 'lookup' | 'confirm' | 'photos' | 'review' | 'success';

type OrderVariant = 'order' | 'fba' | 'repair' | 'exception';

interface PackingWizardState {
  step: PackingWizardStep;
  scannedValue: string | null;
  scannedType: StationScanType | null;
  resolvedOrder: ActivePackingOrder | null;
  resolvedFba: ActiveFbaScan | null;
  orderVariant: OrderVariant;
  packerLogId: number | null;
  resolvedScanType: string | null;
  capturedPhotos: CapturedPhoto[];
  isLoading: boolean;
  errorMessage: string | null;
}

type WizardAction =
  | { type: 'SCAN_CONFIRMED'; value: string; scanType: StationScanType }
  | { type: 'LOOKUP_START' }
  | { type: 'LOOKUP_ORDER_FOUND'; order: ActivePackingOrder; packerLogId: number | null; resolvedScanType: string; variant: OrderVariant }
  | { type: 'LOOKUP_FBA_FOUND'; fba: ActiveFbaScan; packerLogId: number | null }
  | { type: 'LOOKUP_EXCEPTION'; order: ActivePackingOrder; packerLogId: number | null }
  | { type: 'LOOKUP_ERROR'; message: string }
  | { type: 'CONFIRM_YES' }
  | { type: 'CONFIRM_NO' }
  | { type: 'PHOTO_ADDED'; photo: CapturedPhoto }
  | { type: 'PHOTO_REMOVED'; index: number }
  | { type: 'PHOTOS_DONE' }
  | { type: 'PHOTOS_SKIP' }
  | { type: 'COMPLETE_START' }
  | { type: 'COMPLETE_SUCCESS' }
  | { type: 'COMPLETE_ERROR'; message: string }
  | { type: 'BACK' }
  | { type: 'RESET' };

const initialState: PackingWizardState = {
  step: 'scan',
  scannedValue: null,
  scannedType: null,
  resolvedOrder: null,
  resolvedFba: null,
  orderVariant: 'order',
  packerLogId: null,
  resolvedScanType: null,
  capturedPhotos: [],
  isLoading: false,
  errorMessage: null,
};

function wizardReducer(state: PackingWizardState, action: WizardAction): PackingWizardState {
  switch (action.type) {
    case 'SCAN_CONFIRMED':
      return {
        ...initialState,
        step: 'lookup',
        scannedValue: action.value,
        scannedType: action.scanType,
        isLoading: true,
      };
    case 'LOOKUP_START':
      return { ...state, isLoading: true, errorMessage: null };
    case 'LOOKUP_ORDER_FOUND':
      return {
        ...state,
        step: 'confirm',
        isLoading: false,
        resolvedOrder: action.order,
        resolvedFba: null,
        packerLogId: action.packerLogId,
        resolvedScanType: action.resolvedScanType,
        orderVariant: action.variant,
      };
    case 'LOOKUP_FBA_FOUND':
      return {
        ...state,
        step: 'confirm',
        isLoading: false,
        resolvedFba: action.fba,
        resolvedOrder: null,
        packerLogId: action.packerLogId,
        resolvedScanType: 'FBA',
        orderVariant: 'fba',
      };
    case 'LOOKUP_EXCEPTION':
      return {
        ...state,
        step: 'confirm',
        isLoading: false,
        resolvedOrder: action.order,
        resolvedFba: null,
        packerLogId: action.packerLogId,
        resolvedScanType: 'ORDERS',
        orderVariant: 'exception',
      };
    case 'LOOKUP_ERROR':
      return { ...state, step: 'scan', isLoading: false, errorMessage: action.message };
    case 'CONFIRM_YES':
      return { ...state, step: 'photos', capturedPhotos: [] };
    case 'CONFIRM_NO':
      return { ...initialState };
    case 'PHOTO_ADDED':
      return { ...state, capturedPhotos: [...state.capturedPhotos, action.photo] };
    case 'PHOTO_REMOVED':
      return { ...state, capturedPhotos: state.capturedPhotos.filter((_, i) => i !== action.index) };
    case 'PHOTOS_DONE':
    case 'PHOTOS_SKIP':
      return { ...state, step: 'review' };
    case 'COMPLETE_START':
      return { ...state, isLoading: true, errorMessage: null };
    case 'COMPLETE_SUCCESS':
      return { ...state, step: 'success', isLoading: false };
    case 'COMPLETE_ERROR':
      return { ...state, isLoading: false, errorMessage: action.message };
    case 'BACK': {
      const backMap: Record<PackingWizardStep, PackingWizardStep> = {
        scan: 'scan',
        lookup: 'scan',
        confirm: 'scan',
        photos: 'confirm',
        review: 'photos',
        success: 'scan',
      };
      return { ...state, step: backMap[state.step], errorMessage: null };
    }
    case 'RESET':
      return { ...initialState };
    default:
      return state;
  }
}

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
  const [state, dispatch] = useReducer(wizardReducer, initialState);
  const [inputValue, setInputValue] = useState('');
  const [scanSheetOpen, setScanSheetOpen] = useState(false);
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

  // ── Step 2: Order Lookup ───────────────────────────────────────────────────

  const handleLookup = useCallback(async (scanValue: string, scanType: StationScanType) => {
    dispatch({ type: 'SCAN_CONFIRMED', value: scanValue, scanType });

    try {
      // ── FBA path: FNSKU detected ──
      if (scanType === 'FNSKU' || looksLikeFnsku(scanValue)) {
        const res = await fetch('/api/fba/items/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fnsku: scanValue, staff_id: Number(userId), station: 'PACK_STATION' }),
        });
        const data = await res.json();

        if (!res.ok) {
          dispatch({ type: 'LOOKUP_ERROR', message: data?.error || 'FBA scan failed' });
          return;
        }

        dispatch({
          type: 'LOOKUP_FBA_FOUND',
          fba: {
            fnsku: data.fnsku,
            productTitle: data.product_title || scanValue,
            shipmentRef: data.shipment_ref || null,
            plannedQty: Number(data.planned_qty ?? data.expected_qty ?? 0),
            combinedPackScannedQty: Number(data.combined_pack_scanned_qty ?? data.actual_qty ?? 0),
            isNew: !!data.is_new || !!data.auto_added_to_plan,
          },
          packerLogId: data.packerLogId ?? data.packer_log_id ?? null,
        });
        return;
      }

      // ── Regular packing path ──
      const isTrackingInput = !scanValue.includes(':') && !/^(clean|fba-)/i.test(scanValue);
      const normalizedScan = isTrackingInput ? normalizeTracking(scanValue) : scanValue;

      const res = await fetch('/api/packing-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackingNumber: normalizedScan,
          photos: [],
          packerId: String(userId),
          packerName: userName,
          createdAt: formatPSTTimestamp(),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        dispatch({ type: 'LOOKUP_ERROR', message: data?.error || 'Failed to save packing scan' });
        return;
      }

      const resolvedScanType = String(data?.trackingType || '').trim() || 'ORDERS';
      const packerLogId = data.packerRecord?.id ?? null;

      // Dispatch events for the packer table
      if (packerLogId) {
        window.dispatchEvent(new CustomEvent('packer-log-added', { detail: data.packerRecord }));
      }

      if (resolvedScanType === 'FBA' && data?.fba) {
        dispatch({
          type: 'LOOKUP_FBA_FOUND',
          fba: {
            fnsku: String(data.fba.fnskus || '').split(',')[0]?.trim() || '',
            productTitle: String(data?.productTitle || '').trim() || 'FBA Shipment',
            shipmentRef: data.fba.shipment_ref || null,
            plannedQty: Number(data.fba.total_qty ?? 0),
            combinedPackScannedQty: Number(data.fba.total_qty ?? 0),
            isNew: false,
          },
          packerLogId,
        });
      } else if (data?.orderFound === false || data?.isException) {
        // Exception path — no matching order found
        dispatch({
          type: 'LOOKUP_EXCEPTION',
          order: {
            orderId: String(data?.orderId || '').trim(),
            productTitle: String(data?.productTitle || '').trim() || 'Unknown — Exception',
            qty: 1,
            condition: 'N/A',
            tracking: String(data?.shippingTrackingNumber || scanValue).trim(),
            sku: data?.sku || '',
            itemNumber: data?.itemNumber || '',
            shipByDate: data?.shipByDate || '',
            createdAt: data?.createdAt || '',
          },
          packerLogId,
        });
      } else {
        // Standard order found
        const variant: OrderVariant =
          /^RS-/i.test(String(data?.orderId || '')) ? 'repair' : 'order';
        dispatch({
          type: 'LOOKUP_ORDER_FOUND',
          order: {
            orderId: String(data?.orderId || '').trim(),
            productTitle: String(data?.productTitle || '').trim() || 'Unknown product',
            qty: Math.max(1, Number(data?.qty ?? data?.quantity ?? data?.orderQty ?? 1) || 1),
            condition: String(data?.condition || '').trim() || 'N/A',
            tracking: String(data?.shippingTrackingNumber || scanValue).trim(),
            sku: String(data?.sku || '').trim(),
            itemNumber: String(data?.itemNumber || '').trim(),
            shipByDate: data?.shipByDate || '',
            createdAt: data?.createdAt || '',
          },
          packerLogId,
          resolvedScanType,
          variant,
        });
      }
    } catch (err: any) {
      dispatch({ type: 'LOOKUP_ERROR', message: err?.message || 'Scan failed' });
    }
  }, [userId, userName, normalizeTracking]);

  // ── Manual input submit (typed/pasted tracking) ────────────────────────────

  const handleManualSubmit = useCallback(async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    const scan = inputValue.trim();
    if (!scan || state.isLoading) return;
    setInputValue('');
    await handleLookup(scan, detectStationScanType(scan));
  }, [inputValue, state.isLoading, handleLookup]);

  // ── Scan sheet confirmed ───────────────────────────────────────────────────

  const handleScanConfirmed = useCallback(
    (value: string, type: StationScanType) => {
      setScanSheetOpen(false);
      handleLookup(value, type);
    },
    [handleLookup],
  );

  const handleOpenScanSheet = useCallback(() => {
    void requestCameraPermission().finally(() => {
      setScanSheetOpen(true);
    });
  }, []);

  // ── Step 4: Photo uploaded ─────────────────────────────────────────────────

  const handlePhotoAdded = useCallback((photo: CapturedPhoto) => {
    dispatch({ type: 'PHOTO_ADDED', photo });
  }, []);

  const handlePhotoRemoved = useCallback((index: number) => {
    dispatch({ type: 'PHOTO_REMOVED', index });
  }, []);

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
          packerPhotosUrl: state.capturedPhotos.map(p => p.blobUrl),
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
                  onPhotoAdded={handlePhotoAdded}
                  onPhotoRemoved={handlePhotoRemoved}
                  onDone={() => dispatch({ type: 'PHOTOS_DONE' })}
                  onSkip={() => dispatch({ type: 'PHOTOS_SKIP' })}
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
                  isLoading={state.isLoading}
                  errorMessage={state.errorMessage}
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

      {/* ── Camera scan sheet ── */}
      <MobileScanSheet
        isOpen={scanSheetOpen}
        onClose={() => setScanSheetOpen(false)}
        onScanConfirmed={(value, type) => handleScanConfirmed(value, type)}
        manualMode={null}
        onModeChange={() => {}}
      />
    </>
  );
}
