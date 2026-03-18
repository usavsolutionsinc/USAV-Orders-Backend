'use client';

import { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { useQueryClient } from '@tanstack/react-query';
import { useLast8TrackingSearch } from '@/hooks/useLast8TrackingSearch';
import { classifyInput, findSerialInCatalog } from '@/lib/scan-resolver';
import { stationThemeColors } from '@/utils/staff-colors';
export type StationThemeColor = 'green' | 'blue' | 'purple' | 'yellow';

export interface ActiveStationOrder {
  id: number | null;
  orderId: string;
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

function parseRepairServiceId(value: string): number | null {
  const match = value.trim().toUpperCase().match(/^RS-(\d+)$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const LAST_MANUAL_STORAGE_PREFIX = 'usav:last-manual:tech:';
const COMPLETED_ORDER_AUTO_HIDE_MS = 2 * 60 * 1000;

/**
 * detectType
 *
 * Maps a raw scan to one of the controller action types:
 *   TRACKING | SERIAL | FNSKU | SKU | REPAIR | COMMAND
 *
 * Special inputs (SKU, REPAIR, FNSKU, COMMAND) are checked first.
 * Everything else falls through to classifyInput() from scan-resolver,
 * which tests all carrier patterns (UPS, FedEx, USPS, DHL, Amazon, …).
 * Both serial_full and serial_partial resolve to SERIAL so the controller
 * routes them to add-serial; partial serials are catalog-matched there.
 */
function detectType(val: string): string {
  const input = val.trim();
  if (!input) return 'SERIAL';

  // Colon-separated SKU
  if (input.includes(':')) return 'SKU';

  // Repair service ID (RS-12345)
  if (/^RS-\d+$/i.test(input)) return 'REPAIR';

  // Amazon FBA FNSKU (X0… / B0… prefix)
  if (/^(X0|B0)/i.test(input.toUpperCase().replace(/[^A-Z0-9]/g, ''))) return 'FNSKU';

  // Operator commands
  if (['YES', 'USED', 'NEW', 'PARTS', 'TEST'].includes(input.toUpperCase())) return 'COMMAND';

  // Delegate to shared carrier-pattern classifier
  const { type } = classifyInput(input);
  if (type === 'tracking') return 'TRACKING';

  // serial_full, serial_partial, unknown → serial path
  return 'SERIAL';
}

function resolveScanType(
  val: string,
  _options?: { hasActiveOrderContext?: boolean; activeTracking?: string | null },
) {
  return detectType(val);
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
}: {
  userId: string;
  userName: string;
  onComplete?: () => void;
  themeColor: StationThemeColor;
  onTrackingScan?: () => void;
}) {
  const queryClient = useQueryClient();
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [activeOrder, setActiveOrder] = useState<ActiveStationOrder | null>(null);
  const lastScannedOrderRef = useRef<ActiveStationOrder | null>(null);
  const [isActiveOrderVisible, setIsActiveOrderVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [trackingNotFoundAlert, setTrackingNotFoundAlert] = useState<string | null>(null);
  const [resolvedManuals, setResolvedManuals] = useState<ResolvedProductManual[]>([]);
  const [isManualLoading, setIsManualLoading] = useState(false);
  const manualRequestIdRef = useRef(0);
  const completedOrderHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const { normalizeTrackingQuery } = useLast8TrackingSearch();

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
      clearCompletedOrderHideTimer();
      setIsActiveOrderVisible(false);
      return;
    }

    lastScannedOrderRef.current = nextOrder;
    const shouldShow = options?.preserveHidden ? isActiveOrderVisible : true;
    setIsActiveOrderVisible(shouldShow);
    clearCompletedOrderHideTimer();

    if (isOrderComplete(nextOrder) && shouldShow) {
      completedOrderHideTimerRef.current = setTimeout(() => {
        setIsActiveOrderVisible(false);
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

  const handleFnskuScan = async (fnskuInput: string) => {
    setIsLoading(true);
    try {
      const fnsku = fnskuInput.toUpperCase();
      const res = await fetch(`/api/tech/scan-fnsku?fnsku=${encodeURIComponent(fnsku)}&techId=${userId}`);
      const data = await res.json();

      if (!data.found) {
        setErrorMessage(data.error || 'FNSKU not found');
        syncActiveOrderState(null);
        setResolvedManuals([]);
        return;
      }

      syncActiveOrderState({
        id: data.order.id,
        orderId: data.order.orderId,
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
      const res = await fetch(`/api/repair-service/${repairId}`);
      const data = await res.json();

      if (!res.ok || !(data?.id || data?.repair?.id)) {
        setErrorMessage(data?.error || 'Repair not found');
        return;
      }

      const repair = data?.repair ?? data;
      try {
        await fetch('/api/repair-service', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: Number(repair.id),
            statusHistoryEntry: {
              status: 'station_testing_scan',
              source: 'station-testing.scan',
              user_id: Number.isFinite(Number(userId)) ? Number(userId) : null,
              user_name: userName || null,
              metadata: {
                scanned_input: repairScan.trim().toUpperCase(),
                screen: 'StationTesting',
                station: 'TECH',
              },
            },
          }),
        });
      } catch (historyError) {
        console.warn('Repair status history append failed:', historyError);
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

  const handleSubmit = async (e?: React.FormEvent, manualValue?: string) => {
    if (e) e.preventDefault();
    const input = (manualValue || inputValue).trim();
    if (!input) return;

    setErrorMessage(null);
    setSuccessMessage(null);
    setTrackingNotFoundAlert(null);

    const contextOrder = getScanContextOrder();
    const type = resolveScanType(input, {
      hasActiveOrderContext: Boolean(contextOrder),
      activeTracking: contextOrder?.tracking ?? null,
    });

    if (type === 'REPAIR') {
      await handleRepairScan(input);
    } else if (type === 'TRACKING') {
      if (onTrackingScan) onTrackingScan();
      setIsLoading(true);
      try {
        const res = await fetch('/api/tech/scan-tracking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracking: input, techId: userId }),
        });
        const data = await res.json();

        if (!res.ok || !data.found) {
          // Distinguish between a genuine API/network error and a real not-found
          const msg = data?.error
            ? `Scan error: ${data.error}`
            : 'Tracking number not found — logged to exceptions queue.';
          setTrackingNotFoundAlert(msg);
          syncActiveOrderState(null);
          setResolvedManuals([]);
          return;
        }

        // Tracking scan was processed but the order isn't in the system yet
        if (data.orderFound === false) {
          setTrackingNotFoundAlert(
            data.warning || 'Order not in system — tracking logged for reconciliation.'
          );
        }

        syncActiveOrderState({
          id: data.order.id,
          orderId: data.order.orderId,
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
    } else if (type === 'SKU' && getScanContextOrder()) {
      const contextOrder = reopenScanContextOrder();
      if (!contextOrder) {
        setErrorMessage('Please scan a tracking number first');
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

        syncActiveOrderState({
          ...contextOrder,
          serialNumbers: data.updatedSerials,
        });

        setSuccessMessage(
          `SKU matched! Added ${data.serialNumbers.length} serial(s) from SKU lookup (Stock: -${data.quantityDecremented})`
        );

        triggerGlobalRefresh();
      } catch (e) {
        console.error('SKU scan error:', e);
        setErrorMessage('Failed to process SKU');
      } finally {
        setIsLoading(false);
        setInputValue('');
        inputRef.current?.focus();
      }
    } else if (type === 'SKU' && !activeOrder) {
      setErrorMessage('Please scan a tracking number first');
    } else if (type === 'SERIAL' && getScanContextOrder()) {
      const contextOrder = reopenScanContextOrder();
      if (!contextOrder) {
        setErrorMessage('Please scan a tracking number first');
        setInputValue('');
        inputRef.current?.focus();
        return;
      }

      // ── Partial serial resolution ──────────────────────────────────────────
      // classifyInput returns serial_partial for ≤8-char inputs.  Try to
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

      const isFbaDuplicateAllowedTracking = /^(X0|B0|FBA)/i.test(String(contextOrder.tracking || '').trim());

      setIsLoading(true);
      try {
        const res = await fetch('/api/tech/add-serial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tracking: contextOrder.tracking,
            serial: finalSerial,
            techId: userId,
            allowFbaDuplicates: isFbaDuplicateAllowedTracking,
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
        };
        const completedExceptionOrder =
          nextOrder.orderFound === false && isOrderComplete(nextOrder);

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
    } else if (type === 'SERIAL' && !activeOrder) {
      setErrorMessage('Please scan a tracking number first');
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

  const handleSearch = async () => {
    const raw = searchQuery.trim();
    if (!raw) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    setIsSearching(true);
    try {
      // Only apply last-8-digit normalization when the query looks like a
      // pure tracking number (all digits/alphanumeric, no spaces).
      // Product-title and SKU searches should be passed as-is so that letters
      // are not stripped.
      const digitsOnly = raw.replace(/\D/g, '');
      const looksLikeTracking = digitsOnly.length >= 8 && digitsOnly.length === raw.replace(/\s/g, '').length;
      const searchValue = looksLikeTracking ? normalizeTrackingQuery(raw) : raw;

      const res = await fetch(`/api/shipped/search?q=${encodeURIComponent(searchValue)}`);
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      const data = await res.json();

      if (Array.isArray(data.results)) {
        setSearchResults(data.results);
        setShowSearchResults(true);
      }
    } catch (error) {
      console.error('Search error:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
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
    searchQuery,
    setSearchQuery,
    searchResults,
    isSearching,
    showSearchResults,
    setShowSearchResults,
    activeColor,
    handleSubmit,
    handleSearch,
    handleSearchKeyPress,
    triggerGlobalRefresh,
    clearFeedback,
    resolveManual,
    saveManual,
  };
}
