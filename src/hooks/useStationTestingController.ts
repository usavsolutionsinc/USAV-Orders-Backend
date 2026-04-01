'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { classifyInput } from '@/lib/scan-resolver';
import { detectStationScanType, type StationInputMode, type StationScanType } from '@/lib/station-scan-routing';
import { stationThemeColors, type StationTheme } from '@/utils/staff-colors';
import type { ActiveStationOrder, ResolvedProductManual, ScanHandlerContext } from './station/types';
import { handleTrackingScan } from './station/handleTrackingScan';
import { handleFnskuScan } from './station/handleFnskuScan';
import { handleSkuScan } from './station/handleSkuScan';
import { handleSerialScan } from './station/handleSerialScan';
import { handleRepairScan } from './station/handleRepairScan';
import { handleCommand } from './station/handleCommand';

// Re-export types consumed by external components — import paths unchanged.
export { getStationInputMode } from '@/lib/station-scan-routing';
export type { StationInputMode, StationScanType };
export type { ActiveStationOrder, ResolvedProductManual };
/** @deprecated Use StationTheme from '@/utils/staff-colors' instead. */
export type StationThemeColor = StationTheme;

type ForcedStationScanType = 'TRACKING' | 'SERIAL' | 'FNSKU' | 'REPAIR';

const LAST_MANUAL_STORAGE_PREFIX = 'usav:last-manual:tech:';
const COMPLETED_ORDER_AUTO_HIDE_MS = 2 * 60 * 1000;

function newStationIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * When an order is still short on serials, barcodes that look like "generic" tracking
 * (carrier: unknown — e.g. 10+ chars ending in a digit, or 20+ chars) are usually
 * product serials. Known carrier prefixes (1Z, 9[2-5]…, JD, TBA, etc.) still route
 * as TRACKING so a new label can be scanned without arming tracking mode.
 */
function resolveScanType(val: string, contextOrder: ActiveStationOrder | null): StationScanType {
  const base = detectStationScanType(val);
  if (!contextOrder) return base;

  const qty = Math.max(1, Number(contextOrder.quantity) || 1);
  const incomplete = contextOrder.serialNumbers.length < qty;
  if (!incomplete || base !== 'TRACKING') return base;

  const { carrier } = classifyInput(val);
  if (carrier) return 'TRACKING';

  return 'SERIAL';
}

export function getOrderIdLast4(orderId: string) {
  const digits = String(orderId || '').replace(/\D/g, '');
  if (digits.length >= 4) return digits.slice(-4);
  return String(orderId || '').slice(-4);
}

export function useStationTestingController({
  userId,
  userName,
  onComplete,
  themeColor,
  onTrackingScan,
  onTrackingOrderLoaded,
  onActiveOrderCardAutoHidden,
  onFnskuOrderLoaded,
}: {
  userId: string;
  userName: string;
  onComplete?: () => void;
  themeColor: StationThemeColor;
  onTrackingScan?: () => void;
  onTrackingOrderLoaded?: () => void;
  onActiveOrderCardAutoHidden?: () => void;
  onFnskuOrderLoaded?: () => void;
}) {
  const queryClient = useQueryClient();

  // Keep callback refs so handlers always call the latest prop without re-creating ctx.
  const onAutoHiddenRef = useRef(onActiveOrderCardAutoHidden);
  const onFnskuOrderLoadedRef = useRef(onFnskuOrderLoaded);
  useEffect(() => { onAutoHiddenRef.current = onActiveOrderCardAutoHidden; }, [onActiveOrderCardAutoHidden]);
  useEffect(() => { onFnskuOrderLoadedRef.current = onFnskuOrderLoaded; }, [onFnskuOrderLoaded]);

  // ── core state ────────────────────────────────────────────────────────────────
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeOrder, setActiveOrder] = useState<ActiveStationOrder | null>(null);
  const lastScannedOrderRef = useRef<ActiveStationOrder | null>(null);
  const scanSessionIdRef = useRef<string | null>(null);
  const [isActiveOrderVisible, setIsActiveOrderVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [trackingNotFoundAlert, setTrackingNotFoundAlert] = useState<string | null>(null);
  const [resolvedManuals, setResolvedManuals] = useState<ResolvedProductManual[]>([]);
  const [isManualLoading, setIsManualLoading] = useState(false);
  const manualRequestIdRef = useRef(0);
  const completedOrderHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeColor = stationThemeColors[themeColor];

  // ── timer management ──────────────────────────────────────────────────────────
  const clearCompletedOrderHideTimer = () => {
    if (!completedOrderHideTimerRef.current) return;
    clearTimeout(completedOrderHideTimerRef.current);
    completedOrderHideTimerRef.current = null;
  };

  const isOrderComplete = (order: ActiveStationOrder | null) => {
    if (!order) return false;
    const quantity = Math.max(1, Number(order.quantity) || 1);
    return order.serialNumbers.length >= quantity;
  };

  const syncActiveOrderState = (nextOrder: ActiveStationOrder | null, options?: { preserveHidden?: boolean }) => {
    setActiveOrder(nextOrder);
    if (!nextOrder) {
      lastScannedOrderRef.current = null;
      scanSessionIdRef.current = null;
      clearCompletedOrderHideTimer();
      setIsActiveOrderVisible(false);
      return;
    }
    lastScannedOrderRef.current = nextOrder;
    // Always sync the session ref so an FNSKU scan that explicitly clears
    // scanSessionId doesn't leave a stale tracking session.
    if (nextOrder.scanSessionId !== undefined) {
      scanSessionIdRef.current = nextOrder.scanSessionId ?? null;
    }
    const shouldShow = options?.preserveHidden ? isActiveOrderVisible : true;
    setIsActiveOrderVisible(shouldShow);
    clearCompletedOrderHideTimer();
    if (isOrderComplete(nextOrder) && shouldShow) {
      completedOrderHideTimerRef.current = setTimeout(() => {
        setIsActiveOrderVisible(false);
        onAutoHiddenRef.current?.();
      }, COMPLETED_ORDER_AUTO_HIDE_MS);
    }
  };

  const getScanContextOrder = () => activeOrder ?? lastScannedOrderRef.current;
  const reopenScanContextOrder = () => {
    const contextOrder = getScanContextOrder();
    if (!contextOrder) return null;
    syncActiveOrderState(contextOrder);
    return contextOrder;
  };
  const reopenLastActiveOrderCard = () => Boolean(reopenScanContextOrder());

  // ── manual management ─────────────────────────────────────────────────────────
  const publishLastManual = (manuals: ResolvedProductManual[]) => {
    if (typeof window === 'undefined') return;
    const storageKey = `${LAST_MANUAL_STORAGE_PREFIX}${userId}`;
    if (manuals.length > 0) {
      window.localStorage.setItem(storageKey, JSON.stringify(manuals));
    } else {
      window.localStorage.removeItem(storageKey);
    }
    window.dispatchEvent(new CustomEvent('tech-last-manual-updated', {
      detail: { techId: userId, manuals },
    }));
  };

  const clearManuals = () => {
    setResolvedManuals([]);
    publishLastManual([]);
  };

  const resolveManual = async (sku?: string | null, itemNumber?: string | null) => {
    const requestId = ++manualRequestIdRef.current;
    const skuValue = String(sku || '').trim();
    const itemNumberValue = String(itemNumber || '').trim();
    if (!skuValue && !itemNumberValue) {
      clearManuals();
      return;
    }
    setIsManualLoading(true);
    try {
      const params = new URLSearchParams();
      if (skuValue) params.set('sku', skuValue);
      if (itemNumberValue) params.set('itemNumber', itemNumberValue);
      const res = await fetch(`/api/manuals/resolve?${params.toString()}`);
      const data = await res.json();
      if (requestId !== manualRequestIdRef.current) return;
      if (res.ok && data?.found && Array.isArray(data?.manuals) && data.manuals.length > 0) {
        const manuals = data.manuals as ResolvedProductManual[];
        setResolvedManuals(manuals);
        publishLastManual(manuals);
      } else {
        clearManuals();
      }
    } catch (error) {
      console.error('Manual resolve failed:', error);
      if (requestId !== manualRequestIdRef.current) return;
      clearManuals();
    } finally {
      if (requestId !== manualRequestIdRef.current) return;
      setIsManualLoading(false);
    }
  };

  // ── misc helpers ──────────────────────────────────────────────────────────────
  const triggerGlobalRefresh = () => {
    if (onComplete) onComplete();
    window.dispatchEvent(new CustomEvent('usav-refresh-data'));
  };

  const clearFeedback = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setTrackingNotFoundAlert(null);
  };

  // ── effects ───────────────────────────────────────────────────────────────────
  useEffect(() => () => clearCompletedOrderHideTimer(), []);

  useEffect(() => {
    if (errorMessage || successMessage) {
      const timer = setTimeout(() => {
        setErrorMessage(null);
        setSuccessMessage(null);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [errorMessage, successMessage]);

  useEffect(() => {
    if (!trackingNotFoundAlert) return;
    const timer = setTimeout(() => setTrackingNotFoundAlert(null), 2500);
    return () => clearTimeout(timer);
  }, [trackingNotFoundAlert]);

  useEffect(() => {
    if (!activeOrder) {
      manualRequestIdRef.current += 1;
      setResolvedManuals([]);
      setIsManualLoading(false);
      publishLastManual([]);
    }
  }, [activeOrder]);

  useEffect(() => {
    const handleUndoApplied = (e: any) => {
      const tracking = String(e?.detail?.tracking || '');
      const serialNumbers = Array.isArray(e?.detail?.serialNumbers) ? e.detail.serialNumbers : [];
      const removedSerial = e?.detail?.removedSerial;
      if (!activeOrder) return;
      if (String(activeOrder.tracking || '') !== tracking) return;
      syncActiveOrderState({ ...activeOrder, serialNumbers }, { preserveHidden: true });
      if (removedSerial) {
        setSuccessMessage(`Undo successful: removed ${removedSerial}`);
      } else {
        setSuccessMessage('Undo successful');
      }
    };
    window.addEventListener('tech-undo-applied' as any, handleUndoApplied as any);
    return () => window.removeEventListener('tech-undo-applied' as any, handleUndoApplied as any);
  }, [activeOrder]);

  useEffect(() => {
    const handleTechLogRemoved = (e: any) => {
      if (!activeOrder) return;
      const { tracking, fnsku } = e?.detail ?? {};
      const activeTracking = String(activeOrder.tracking || '').trim().toUpperCase();
      const activeFnsku = String(activeOrder.fnsku || '').trim().toUpperCase();
      const eventTracking = String(tracking || '').trim().toUpperCase();
      const eventFnsku = String(fnsku || '').trim().toUpperCase();
      const matchesByTracking = eventTracking && activeTracking === eventTracking;
      const matchesByFnsku =
        activeFnsku && eventFnsku && (activeFnsku === eventFnsku || activeTracking === eventFnsku);
      if (!matchesByTracking && !matchesByFnsku) return;
      syncActiveOrderState(null);
    };
    window.addEventListener('tech-log-removed' as any, handleTechLogRemoved as any);
    return () => window.removeEventListener('tech-log-removed' as any, handleTechLogRemoved as any);
  }, [activeOrder]);

  // ── shared context assembled for handlers ─────────────────────────────────────
  const buildCtx = (): ScanHandlerContext => ({
    userId,
    userName,
    getScanContextOrder,
    reopenScanContextOrder,
    syncActiveOrderState,
    setIsLoading,
    setErrorMessage,
    setSuccessMessage,
    setInputValue,
    inputRef,
    scanSessionIdRef,
    queryClient,
    triggerGlobalRefresh,
    resolveManual,
    clearManuals,
    newIdempotencyKey: newStationIdempotencyKey,
  });

  // ── main submit router ────────────────────────────────────────────────────────
  const handleSubmit = async (
    e?: React.FormEvent,
    manualValue?: string,
    options?: { forcedType?: ForcedStationScanType | null },
  ) => {
    if (e) e.preventDefault();
    const input = (manualValue || inputValue).trim();
    if (!input) return;

    clearFeedback();

    const contextOrder = getScanContextOrder();
    const forcedType = options?.forcedType;
    const type: StationScanType =
      forcedType === 'TRACKING' || forcedType === 'SERIAL' || forcedType === 'FNSKU' || forcedType === 'REPAIR'
        ? forcedType
        : resolveScanType(input, contextOrder);

    const ctx = buildCtx();

    switch (type) {
      case 'TRACKING': return handleTrackingScan(input, ctx, { onTrackingScan, onTrackingOrderLoaded });
      case 'FNSKU':    return handleFnskuScan(input, ctx, { onFnskuOrderLoaded: onFnskuOrderLoadedRef.current });
      case 'SKU':      return handleSkuScan(input, ctx);
      case 'SERIAL':   return handleSerialScan(input, ctx);
      case 'REPAIR':   return handleRepairScan(input, ctx);
      case 'COMMAND':  return handleCommand(input, ctx, { onComplete });
    }
  };

  return {
    inputValue,
    setInputValue,
    isLoading,
    inputRef,
    activeOrder,
    setActiveOrder: syncActiveOrderState,
    isActiveOrderVisible,
    errorMessage,
    successMessage,
    trackingNotFoundAlert,
    resolvedManuals,
    isManualLoading,
    activeColor,
    handleSubmit,
    triggerGlobalRefresh,
    clearFeedback,
    reopenLastActiveOrderCard,
  };
}
