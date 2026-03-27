'use client';

import { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { useQueryClient } from '@tanstack/react-query';
import { classifyInput, findSerialInCatalog, looksLikeFnsku } from '@/lib/scan-resolver';
import { detectStationScanType, type StationInputMode, type StationScanType } from '@/lib/station-scan-routing';
import { stationThemeColors } from '@/utils/staff-colors';

export { getStationInputMode } from '@/lib/station-scan-routing';
export type { StationInputMode, StationScanType };
export type StationThemeColor = 'green' | 'blue' | 'purple' | 'yellow';

export interface ActiveStationOrder {
  id: number | null;
  orderId: string;
  fnsku?: string | null;
  /** `fba_fnsku_logs.id` — links serials to the FNSKU log row in the TSN table. */
  fnskuLogId?: number | null;
  /** SAL row id — the single source of truth anchor for this scan session. */
  salId?: number | null;
  productTitle: string;
  itemNumber: string | null;
  sku: string;
  condition: string;
  notes: string;
  tracking: string;
  serialNumbers: string[];
  testDateTime: string | null;
  testedBy: number | null;
  quantity?: number;
  shipByDate?: string | null;
  createdAt?: string | null;
  orderFound?: boolean;
  sourceType?: 'order' | 'fba' | 'repair';
  /** Server-issued anchor for serial/SKU scans (tracking / exception / FNSKU / repair session). */
  scanSessionId?: string | null;
  /** Friendly inline UX copy rendered inside the active order card. */
  inlineMicrocopy?: string | null;
}

export interface ResolvedProductManual {
  id: number;
  sku: string | null;
  itemNumber: string | null;
  googleFileId: string;
  type: string | null;
  matchedBy: 'sku' | 'item_number';
  updatedAt: string;
  previewUrl: string;
  viewUrl: string;
  downloadUrl: string;
}

type ForcedStationScanType = 'TRACKING' | 'SERIAL' | 'FNSKU' | 'REPAIR';

function parseRepairServiceId(value: string): number | null {
  const match = value.trim().toUpperCase().match(/^RS-(\d+)$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

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
 * (classifier carrier unknown — e.g. 10+ chars ending in a digit, or 20+ chars) are
 * usually product serials. Routing them as TRACKING would run scan-tracking, reuse/widen
 * SAL rows by last-8, and the next "add serial to last" can attach to the wrong shipment.
 * Explicit carrier-shaped labels (UPS 1Z…, etc.) still route as TRACKING so a new label
 * can be scanned; use the tracking mode button if a generic-looking code is truly a label.
 */
function resolveScanType(val: string, contextOrder: ActiveStationOrder | null): StationScanType {
  const base = detectStationScanType(val);
  if (!contextOrder) return base;

  const qty = Math.max(1, Number(contextOrder.quantity) || 1);
  const incomplete = contextOrder.serialNumbers.length < qty;
  if (!incomplete || base !== 'TRACKING') return base;

  // When an active order still needs serials, route ANY tracking-shaped input as
  // SERIAL. Product serial numbers routinely match carrier patterns (e.g. a 12-digit
  // serial triggers the FedEx heuristic). Routing those as TRACKING would hit the
  // scan-tracking API, fail to find an order, clear the active card, and show the
  // "not found" alert — exactly the bug. Techs who genuinely need to scan a new
  // label while a card is open can use the tracking mode button to force it.
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
  /** Fired after a tracking scan successfully loads order context (input cleared). UI can drop tracking-only display override so SN mode shows. */
  onTrackingOrderLoaded?: () => void;
  /** Fired when the active order card auto-hides after qty-complete timeout (UI can switch back to tracking mode). */
  onActiveOrderCardAutoHidden?: () => void;
  /** Fired after an FNSKU scan successfully loads order context. UI can clear FBA manual mode override. */
  onFnskuOrderLoaded?: () => void;
}) {
  const queryClient = useQueryClient();
  const onAutoHiddenRef = useRef(onActiveOrderCardAutoHidden);
  const onFnskuOrderLoadedRef = useRef(onFnskuOrderLoaded);
  useEffect(() => { onFnskuOrderLoadedRef.current = onFnskuOrderLoaded; }, [onFnskuOrderLoaded]);
  useEffect(() => {
    onAutoHiddenRef.current = onActiveOrderCardAutoHidden;
  }, [onActiveOrderCardAutoHidden]);
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
    // Always sync the session ref — including null — so an FNSKU scan that
    // explicitly clears scanSessionId doesn't leave a stale tracking session
    // that would cause add-serial validation to reject subsequent serial scans.
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

  const reopenLastActiveOrderCard = () => {
    return Boolean(reopenScanContextOrder());
  };

  const publishLastManual = (manuals: ResolvedProductManual[]) => {
    if (typeof window === 'undefined') return;
    const storageKey = `${LAST_MANUAL_STORAGE_PREFIX}${userId}`;

    if (manuals.length > 0) {
      window.localStorage.setItem(storageKey, JSON.stringify(manuals));
    } else {
      window.localStorage.removeItem(storageKey);
    }

    window.dispatchEvent(
      new CustomEvent('tech-last-manual-updated', {
        detail: { techId: userId, manuals },
      })
    );
  };

  const triggerGlobalRefresh = () => {
    if (onComplete) onComplete();
    window.dispatchEvent(new CustomEvent('usav-refresh-data'));
  };

  const clearFeedback = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setTrackingNotFoundAlert(null);
  };

  useEffect(() => () => clearCompletedOrderHideTimer(), []);

  const resolveManual = async (sku?: string | null, itemNumber?: string | null) => {
    const requestId = ++manualRequestIdRef.current;
    const skuValue = String(sku || '').trim();
    const itemNumberValue = String(itemNumber || '').trim();

    if (!skuValue && !itemNumberValue) {
      setResolvedManuals([]);
      publishLastManual([]);
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
        setResolvedManuals([]);
        publishLastManual([]);
      }
    } catch (error) {
      console.error('Manual resolve failed:', error);
      if (requestId !== manualRequestIdRef.current) return;
      setResolvedManuals([]);
      publishLastManual([]);
    } finally {
      if (requestId !== manualRequestIdRef.current) return;
      setIsManualLoading(false);
    }
  };

  const saveManual = async (params: {
    sku?: string | null;
    itemNumber?: string | null;
    googleLinkOrFileId: string;
    type?: string | null;
  }): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/manuals/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: params.sku || null,
          itemNumber: params.itemNumber || null,
          googleLinkOrFileId: params.googleLinkOrFileId,
          type: params.type || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        return { success: false, error: data?.error || 'Failed to save manual' };
      }
      await resolveManual(params.sku, params.itemNumber);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Failed to save manual' };
    }
  };

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
      syncActiveOrderState({
        ...activeOrder,
        serialNumbers,
      }, { preserveHidden: true });
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
      // Match by FNSKU regardless of sourceKind — tech_serial rows that
      // belong to an FNSKU log still carry the fnsku field.
      const matchesByFnsku =
        activeFnsku &&
        eventFnsku &&
        (activeFnsku === eventFnsku || activeTracking === eventFnsku);
      if (!matchesByTracking && !matchesByFnsku) return;
      syncActiveOrderState(null);
    };
    window.addEventListener('tech-log-removed' as any, handleTechLogRemoved as any);
    return () => window.removeEventListener('tech-log-removed' as any, handleTechLogRemoved as any);
  }, [activeOrder]);

  const handleFnskuScan = async (fnskuInput: string) => {
    setIsLoading(true);
    try {
      const fnsku = fnskuInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const res = await fetch('/api/tech/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'FNSKU', value: fnsku, techId: userId }),
      });
      const data = await res.json();

      if (!data.found) {
        setErrorMessage(data.error || 'FNSKU not found');
        syncActiveOrderState(null);
        setResolvedManuals([]);
        return;
      }

      syncActiveOrderState({
        id: data.order.id ?? null,
        orderId: data.order.orderId ?? 'FNSKU',
        fnsku,
        fnskuLogId: data.fnskuLogId ?? null,
        salId: data.salId ?? null,
        productTitle: data.order.productTitle ?? data.order.tracking ?? fnsku,
        itemNumber: data.order.itemNumber ?? null,
        sku: data.order.sku ?? 'N/A',
        condition: data.order.condition ?? 'N/A',
        notes: data.order.notes ?? '',
        tracking: data.order.tracking ?? fnsku,
        serialNumbers: data.order.serialNumbers || [],
        testDateTime: data.order.testDateTime,
        testedBy: data.order.testedBy,
        quantity: parseInt(String(data.order.quantity || 1), 10) || 1,
        shipByDate: data.order.shipByDate || null,
        createdAt: data.order.createdAt || null,
        orderFound: data.orderFound !== false,
        sourceType: 'fba',
        scanSessionId: data.scanSessionId ?? null,
        inlineMicrocopy: data.catalogMessage ?? null,
      });

      const serialCount = data.order.serialNumbers?.length || 0;
      const techCount = Number(data?.summary?.tech_scanned_qty ?? 0);
      const packCount = Number(data?.summary?.pack_ready_qty ?? 0);
      if (serialCount > 0) {
        setSuccessMessage(`FNSKU loaded: ${serialCount} serial${serialCount !== 1 ? 's' : ''} on file · tech ${techCount} · ready ${packCount}`);
      } else {
        setSuccessMessage(`FNSKU loaded - tech ${techCount} · ready ${packCount}`);
      }

      if (data.orderFound === false) {
        setResolvedManuals([]);
        publishLastManual([]);
      } else {
        void resolveManual(data.order.sku, data.order.itemNumber ?? null);
      }

      onFnskuOrderLoadedRef.current?.();

      if (data.salId || data.fnskuSalId) {
        const eventSalId = data.salId ?? data.fnskuSalId;
        window.dispatchEvent(new CustomEvent('tech-log-added', {
          detail: {
            id: -1 * Number(eventSalId),
            source_row_id: Number(eventSalId),
            source_kind: 'fba_scan',
            tech_serial_id: null,
            created_at: data.order.testDateTime ?? data.order.createdAt ?? null,
            shipping_tracking_number: data.order.tracking ?? fnsku,
            serial_number: '',
            tested_by: data.order.testedBy ?? (Number.isFinite(Number(userId)) ? Number(userId) : null),
            shipment_id: data.shipment?.shipment_id ?? null,
            order_db_id: null,
            order_id: data.order.orderId ?? 'FBA',
            product_title: data.order.productTitle ?? null,
            item_number: data.order.itemNumber ?? null,
            sku: data.order.sku ?? null,
            condition: data.order.condition ?? null,
            fnsku,
            fnsku_log_id: data.fnskuLogId ?? null,
            status: data.order.status ?? null,
            status_history: data.order.statusHistory ?? [],
            notes: data.order.notes ?? null,
            account_source: data.order.accountSource ?? 'fba',
            quantity: String(data.order.quantity || '1'),
            is_shipped: Boolean(data.order.isShipped),
            ship_by_date: data.order.shipByDate ?? null,
            out_of_stock: data.order.outOfStock ?? null,
          },
        }));
      }
      const techLogsTechId = Number(userId);
      queryClient.invalidateQueries(
        Number.isFinite(techLogsTechId) && techLogsTechId > 0
          ? { queryKey: ['tech-logs', techLogsTechId] }
          : { queryKey: ['tech-logs'] },
      );
      // Notify FBA workspace sidebar so techs can add this FNSKU to an open plan.
      window.dispatchEvent(
        new CustomEvent('fba-fnsku-station-scanned', {
          detail: {
            fnsku,
            productTitle: data.order?.productTitle ?? null,
            shipmentId: data.shipment?.shipment_id ?? null,
            planRef: data.shipment?.shipment_ref ?? null,
          },
        }),
      );

      triggerGlobalRefresh();
    } catch (err) {
      console.error('FNSKU scan failed:', err);
      setErrorMessage('Failed to load FNSKU. Please try again.');
    } finally {
      setIsLoading(false);
      setInputValue('');
      inputRef.current?.focus();
    }
  };

  const handleRepairScan = async (repairScan: string) => {
    const repairId = parseRepairServiceId(repairScan);
    if (!repairId) {
      setErrorMessage('Invalid repair service barcode');
      setInputValue('');
      inputRef.current?.focus();
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/tech/scan-repair-station', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repairScan: repairScan.trim(),
          repairId,
          techId: userId,
          userName: userName || null,
          idempotencyKey: newStationIdempotencyKey(),
        }),
      });
      const data = await res.json();

      if (!res.ok || !data?.success || !data?.repair?.id) {
        setErrorMessage(data?.error || 'Repair not found');
        return;
      }

      const repair = data.repair;
      if (typeof data.scanSessionId === 'string' && data.scanSessionId) {
        scanSessionIdRef.current = data.scanSessionId;
      }

      window.dispatchEvent(new CustomEvent('open-repair-details', {
        detail: {
          repairId: Number(repair.id),
          assignmentId: null,
          assignedTechId: null,
        },
      }));
      setSuccessMessage(`Repair loaded: RS-${repair.id}`);
      setResolvedManuals([]);
    } catch (error) {
      console.error('Repair scan failed:', error);
      setErrorMessage('Failed to load repair');
    } finally {
      setIsLoading(false);
      setInputValue('');
      inputRef.current?.focus();
    }
  };

  const handleSubmit = async (
    e?: React.FormEvent,
    manualValue?: string,
    options?: { forcedType?: ForcedStationScanType | null },
  ) => {
    if (e) e.preventDefault();
    const input = (manualValue || inputValue).trim();
    if (!input) return;

    setErrorMessage(null);
    setSuccessMessage(null);
    setTrackingNotFoundAlert(null);

    const contextOrder = getScanContextOrder();
    const forcedType = options?.forcedType;
    const type: StationScanType =
      forcedType === 'TRACKING' ||
      forcedType === 'SERIAL' ||
      forcedType === 'FNSKU' ||
      forcedType === 'REPAIR'
        ? forcedType
        : resolveScanType(input, contextOrder);

    if (type === 'REPAIR') {
      await handleRepairScan(input);
    } else if (type === 'TRACKING') {
      if (onTrackingScan) onTrackingScan();
      setIsLoading(true);
      try {
        const res = await fetch('/api/tech/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'TRACKING',
            value: input,
            techId: userId,
            idempotencyKey: newStationIdempotencyKey(),
          }),
        });
        const data = await res.json();

        if (!res.ok || !data.found) {
          // Distinguish between a genuine API/network error and a real not-found
          const msg = data?.error
            ? `Scan error: ${data.error}`
            : 'Tracking number not found — logged to exceptions queue.';
          setErrorMessage(msg);
          syncActiveOrderState(null);
          setResolvedManuals([]);
          return;
        }

        // Tracking scan was processed but the order isn't in the system yet.
        // Keep the message inside the active order card instead of a separate alert bubble.
        const trackingMicrocopy =
          data.orderFound === false && !data.fnskuLogId
            ? (data.warning || 'Order not in system — tracking logged for reconciliation.')
            : null;

        syncActiveOrderState({
          id: data.order.id,
          orderId: data.order.orderId,
          salId: data.salId ?? null,
          productTitle: data.order.productTitle,
          itemNumber: data.order.itemNumber ?? null,
          sku: data.order.sku,
          condition: data.order.condition,
          notes: data.order.notes,
          tracking: data.order.tracking,
          serialNumbers: data.order.serialNumbers || [],
          testDateTime: data.order.testDateTime,
          testedBy: data.order.testedBy,
          quantity: parseInt(String(data.order.quantity || 1), 10) || 1,
          shipByDate: data.order.shipByDate || null,
          createdAt: data.order.createdAt || null,
          orderFound: data.orderFound !== false,
          scanSessionId: typeof data.scanSessionId === 'string' ? data.scanSessionId : null,
          inlineMicrocopy: trackingMicrocopy,
        });

        const serialCount = data.order.serialNumbers?.length || 0;
        if (serialCount > 0) {
          setSuccessMessage(`Order loaded: ${serialCount} serial${serialCount !== 1 ? 's' : ''} already scanned`);
        } else {
          setSuccessMessage('Order loaded - ready to scan serials');
        }

        if (data.orderFound === false) {
          setResolvedManuals([]);
          publishLastManual([]);
        } else {
          void resolveManual(data.order.sku, data.order.itemNumber ?? null);
        }

        onTrackingOrderLoaded?.();

        // Surgical cache insert: fire a targeted event so TechTable can prepend
        // the new row via setQueryData without invalidating the whole cache.
        if (data.techSerialId) {
          window.dispatchEvent(new CustomEvent('tech-log-added', {
            detail: {
              id: data.techSerialId,
              order_db_id: data.order.id ?? null,
              shipment_id: data.order.shipmentId ?? null,
              created_at: data.order.testDateTime ?? null,
              shipping_tracking_number: data.order.tracking ?? '',
              serial_number: '',
              tested_by: data.order.testedBy ?? null,
              order_id: data.order.orderId !== 'N/A' ? data.order.orderId : null,
              product_title: data.order.productTitle ?? null,
              item_number: data.order.itemNumber ?? null,
              sku: data.order.sku !== 'N/A' ? data.order.sku : null,
              condition: data.order.condition !== 'N/A' ? data.order.condition : null,
              status: data.order.status ?? null,
              status_history: data.order.statusHistory ?? [],
              notes: data.order.notes ?? null,
              account_source: data.order.accountSource ?? null,
              quantity: String(data.order.quantity || '1'),
              is_shipped: data.order.isShipped ?? false,
              ship_by_date: data.order.shipByDate ?? null,
              out_of_stock: null,
            },
          }));
        } else if (data.techActivityId) {
          // Exception scan (no order found): the SAL row id maps to the negative
          // id format used by tracking_scan_rows in tech-logs SQL.
          window.dispatchEvent(new CustomEvent('tech-log-added', {
            detail: {
              id: -1000000000 - data.techActivityId,
              source_row_id: data.techActivityId,
              source_kind: 'tech_scan',
              tech_serial_id: null,
              created_at: data.order.testDateTime ?? null,
              shipping_tracking_number: data.order.tracking ?? '',
              serial_number: '',
              tested_by: data.order.testedBy ?? null,
              shipment_id: null,
              order_db_id: null,
              order_id: null,
              product_title: 'Unknown Product',
              item_number: null,
              sku: null,
              condition: null,
              status: null,
              status_history: [],
              notes: 'Tracking recorded in orders_exceptions',
              account_source: null,
              quantity: '1',
              is_shipped: false,
              ship_by_date: null,
              out_of_stock: null,
            },
          }));
        }
        triggerGlobalRefresh();
      } catch (err) {
        console.error('Tracking scan failed:', err);
        setErrorMessage('Failed to load order. Please try again.');
      } finally {
        setIsLoading(false);
        setInputValue('');
        inputRef.current?.focus();
      }
    } else if (type === 'FNSKU') {
      await handleFnskuScan(input);
    } else if (type === 'SKU') {
      const contextOrder = reopenScanContextOrder();
      if (!contextOrder) {
        setInputValue('');
        inputRef.current?.focus();
        return;
      }
      const skuCode = input;

      setIsLoading(true);
      try {
        const res = await fetch('/api/tech/scan-sku', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skuCode,
            tracking: contextOrder.tracking,
            techId: userId,
            scanSessionId: (contextOrder.scanSessionId ?? scanSessionIdRef.current) || undefined,
            idempotencyKey: newStationIdempotencyKey(),
          }),
        });

        const data = await res.json();

        if (!data.success) {
          setErrorMessage(data.error || 'Failed to process SKU');
          return;
        }

        if (data.notes) {
          alert(`Notes for SKU:\n\n${data.notes}`);
        }

        const nextSerials = Array.isArray(data.updatedSerials)
          ? data.updatedSerials
          : contextOrder.serialNumbers;

        syncActiveOrderState({
          ...contextOrder,
          serialNumbers: nextSerials,
          scanSessionId:
            typeof data.scanSessionId === 'string'
              ? data.scanSessionId
              : contextOrder.scanSessionId ?? scanSessionIdRef.current,
        });

        const addedCount = Array.isArray(data.serialNumbers) ? data.serialNumbers.length : 0;
        setSuccessMessage(
          addedCount > 0
            ? `SKU matched! Added ${addedCount} serial(s) from SKU lookup (Stock: -${data.quantityDecremented})`
            : `SKU matched — stock −${data.quantityDecremented}${data.productTitle ? ` · ${data.productTitle}` : ''}`,
        );

        queryClient.invalidateQueries({ queryKey: ['tech-logs'] });
        triggerGlobalRefresh();
      } catch (e) {
        console.error('SKU scan error:', e);
        setErrorMessage('Failed to process SKU');
      } finally {
        setIsLoading(false);
        setInputValue('');
        inputRef.current?.focus();
      }
    } else if (type === 'SERIAL') {
      const contextOrder = reopenScanContextOrder();
      if (!contextOrder) {
        // No active order — add the serial to the last scanned tracking in TSN.
        // The endpoint resolves the most recent TRACKING_SCANNED SAL for this tech,
        // inserts (or creates) the TSN row, then returns the order info so the
        // active order card can be restored.
        setIsLoading(true);
        try {
          const res = await fetch('/api/tech/add-serial-to-last', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              serial: input.toUpperCase(),
              techId: userId,
              scanSessionId: scanSessionIdRef.current || undefined,
              idempotencyKey: newStationIdempotencyKey(),
            }),
          });
          const data = await res.json();

          if (!data.success) {
            setErrorMessage(data.error || 'Failed to add serial');
            return;
          }

          syncActiveOrderState({
            id: data.order.id ?? null,
            orderId: data.order.orderId,
            productTitle: data.order.productTitle,
            itemNumber: data.order.itemNumber ?? null,
            sku: data.order.sku,
            condition: data.order.condition,
            notes: data.order.notes,
            tracking: data.order.tracking,
            serialNumbers: data.serialNumbers,
            testDateTime: null,
            testedBy: null,
            quantity: data.order.quantity || 1,
            shipByDate: data.order.shipByDate ?? null,
            createdAt: data.order.createdAt ?? null,
            orderFound: data.order.orderFound !== false,
            scanSessionId:
              typeof data.scanSessionId === 'string'
                ? data.scanSessionId
                : scanSessionIdRef.current,
          });

          setSuccessMessage(`Serial ${input.toUpperCase()} added ✓ (${data.serialNumbers.length} total)`);
          if (data.isComplete) {
            confetti({ particleCount: 100, spread: 70 });
          }
          queryClient.invalidateQueries({ queryKey: ['tech-logs'] });
          triggerGlobalRefresh();
        } catch (err) {
          console.error('Add serial to last error:', err);
          setErrorMessage('Network error occurred');
        } finally {
          setIsLoading(false);
          setInputValue('');
          inputRef.current?.focus();
        }
        return;
      }

      // ── Partial serial resolution ──────────────────────────────────────────
      // classifyInput returns serial_partial for ≤10-char inputs.  Try to
      // expand the partial by suffix-matching it against already-scanned serials
      // on this order.  If exactly one match is found we use the full canonical
      // serial; if zero or multiple, store the raw partial as-is.
      const { type: scanKind } = classifyInput(input);
      let finalSerial = input.toUpperCase();
      if (scanKind === 'serial_partial' && contextOrder.serialNumbers.length > 0) {
        const { matchType, matches } = findSerialInCatalog(input, contextOrder.serialNumbers);
        if (matchType !== 'none' && matches.length === 1) {
          finalSerial = matches[0].toUpperCase();
          setSuccessMessage(`Partial matched → ${finalSerial}`);
        } else if (matches.length > 1) {
          setErrorMessage(`Partial "${input}" is ambiguous — ${matches.length} serials match. Scan the full serial.`);
          setInputValue('');
          inputRef.current?.focus();
          return;
        }
        // matchType === 'none' → fall through and store the raw partial
      }

      const trk = String(contextOrder.tracking || '').trim();
      const isFbaDuplicateAllowedTracking = looksLikeFnsku(trk) || /^FBA/i.test(trk);

      setIsLoading(true);
      try {
        const sessionForSerial =
          (contextOrder.scanSessionId ?? scanSessionIdRef.current) || undefined;
        const res = await fetch('/api/tech/add-serial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tracking: contextOrder.tracking,
            serial: finalSerial,
            techId: userId,
            allowFbaDuplicates: isFbaDuplicateAllowedTracking,
            scanSessionId: sessionForSerial,
            idempotencyKey: newStationIdempotencyKey(),
          }),
        });

        const data = await res.json();

        if (!data.success) {
          setErrorMessage(data.error || 'Failed to add serial');
          return;
        }

        const nextOrder = {
          ...contextOrder,
          serialNumbers: data.serialNumbers,
          scanSessionId:
            typeof data.scanSessionId === 'string'
              ? data.scanSessionId
              : contextOrder.scanSessionId ?? scanSessionIdRef.current,
        };
        // FBA/FNSKU orders always have orderFound=false (they don't map to an orders row),
        // so we must exclude them from the exception-card auto-clear logic. Without this,
        // the card disappears after the very first serial and subsequent serials lose context.
        const completedExceptionOrder =
          nextOrder.orderFound === false &&
          nextOrder.sourceType !== 'fba' &&
          isOrderComplete(nextOrder);

        if (completedExceptionOrder) {
          syncActiveOrderState(null);
        } else {
          syncActiveOrderState(nextOrder);
        }

        setSuccessMessage(`Serial ${finalSerial} added ✓ (${data.serialNumbers.length} total)`);

        if (data.isComplete) {
          confetti({ particleCount: 100, spread: 70 });
        }

        // Refresh TechTable so the new serial row (SERIAL_ADDED SAL entry) appears immediately.
        queryClient.invalidateQueries({ queryKey: ['tech-logs'] });
        triggerGlobalRefresh();
      } catch (e) {
        console.error('Add serial error:', e);
        setErrorMessage('Network error occurred');
      } finally {
        setIsLoading(false);
        setInputValue('');
        inputRef.current?.focus();
      }
    } else if (type === 'COMMAND') {
      const command = input.toUpperCase();
      if (command === 'TEST') {
        syncActiveOrderState({
          id: 99999,
          orderId: 'TEST-ORD-001',
          productTitle: 'TEST UNIT - Sony Alpha a7 IV',
          itemNumber: 'B000TEST000',
          sku: 'TEST-SKU',
          condition: 'Used - Excellent',
          notes: 'This is a test order for debugging',
          tracking: 'TEST-TRK-123',
          serialNumbers: [],
          testDateTime: null,
          testedBy: null,
          quantity: 1,
          shipByDate: null,
          createdAt: null,
          orderFound: true,
        });
        setResolvedManuals([]);
        setSuccessMessage('Test order loaded');
      } else if (command === 'YES' && activeOrder) {
        syncActiveOrderState(null);
        setResolvedManuals([]);
        setSuccessMessage('Order completed!');
        triggerGlobalRefresh();
      } else if (command === 'YES' && !activeOrder) {
        setErrorMessage('No active order to complete');
      }
    }

    setInputValue('');
    inputRef.current?.focus();
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
