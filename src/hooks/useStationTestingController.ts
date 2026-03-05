'use client';

import { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { useLast8TrackingSearch } from '@/hooks/useLast8TrackingSearch';
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

const LAST_MANUAL_STORAGE_PREFIX = 'usav:last-manual:tech:';

function detectType(val: string) {
  const input = val.trim();

  if (input.includes(':')) return 'SKU';
  if (input.match(/^(1Z|42|93|96|JJD|JD|94|92|JVGL|420)/i)) return 'TRACKING';
  if (input.match(/^X0/i)) return 'FNSKU';
  if (['YES', 'USED', 'NEW', 'PARTS', 'TEST'].includes(input.toUpperCase())) return 'COMMAND';
  return 'SERIAL';
}

export function getOrderIdLast4(orderId: string) {
  const digits = String(orderId || '').replace(/\D/g, '');
  if (digits.length >= 4) return digits.slice(-4);
  return String(orderId || '').slice(-4);
}

export function useStationTestingController({
  userId,
  onComplete,
  themeColor,
  onTrackingScan,
}: {
  userId: string;
  onComplete?: () => void;
  themeColor: StationThemeColor;
  onTrackingScan?: () => void;
}) {
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [activeOrder, setActiveOrder] = useState<ActiveStationOrder | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [trackingNotFoundAlert, setTrackingNotFoundAlert] = useState<string | null>(null);
  const [resolvedManuals, setResolvedManuals] = useState<ResolvedProductManual[]>([]);
  const [isManualLoading, setIsManualLoading] = useState(false);
  const manualRequestIdRef = useRef(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const { normalizeTrackingQuery } = useLast8TrackingSearch();

  const activeColor = stationThemeColors[themeColor];

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
      setActiveOrder({
        ...activeOrder,
        serialNumbers,
      });
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
        setActiveOrder(null);
        setResolvedManuals([]);
        return;
      }

      setActiveOrder({
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
        setSuccessMessage(`FNSKU loaded: ${serialCount} serial${serialCount !== 1 ? 's' : ''} already scanned`);
      } else {
        setSuccessMessage('FNSKU loaded - ready to scan serials');
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

  const handleSubmit = async (e?: React.FormEvent, manualValue?: string) => {
    if (e) e.preventDefault();
    const input = (manualValue || inputValue).trim();
    if (!input) return;

    setErrorMessage(null);
    setSuccessMessage(null);
    setTrackingNotFoundAlert(null);

    const type = detectType(input);

    if (type === 'TRACKING') {
      if (onTrackingScan) onTrackingScan();
      setIsLoading(true);
      try {
        const res = await fetch('/api/tech/scan-tracking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracking: input, techId: userId }),
        });
        const data = await res.json();

        if (!data.found) {
          setTrackingNotFoundAlert('Tracking number not found in the system');
          setActiveOrder(null);
          setResolvedManuals([]);
          return;
        }

        setActiveOrder({
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
              test_date_time: data.order.testDateTime ?? null,
              shipping_tracking_number: data.order.tracking ?? '',
              serial_number: '',
              tested_by: data.order.testedBy ?? null,
              order_id: data.order.orderId !== 'N/A' ? data.order.orderId : null,
              product_title: data.order.productTitle ?? null,
              item_number: data.order.itemNumber ?? null,
              sku: data.order.sku !== 'N/A' ? data.order.sku : null,
              condition: data.order.condition !== 'N/A' ? data.order.condition : null,
              notes: data.order.notes ?? null,
              account_source: data.order.accountSource ?? null,
              quantity: String(data.order.quantity || '1'),
              is_shipped: data.order.isShipped ?? false,
              ship_by_date: data.order.shipByDate ?? null,
              created_at: data.order.createdAt ?? null,
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
    } else if (type === 'SKU' && activeOrder) {
      const skuCode = input;

      setIsLoading(true);
      try {
        const res = await fetch('/api/tech/scan-sku', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skuCode,
            tracking: activeOrder.tracking,
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

        setActiveOrder({
          ...activeOrder,
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
    } else if (type === 'SERIAL' && activeOrder) {
      const finalSerial = input.toUpperCase();
      const isFbaDuplicateAllowedTracking = /^(X0|B0|FBA)/i.test(String(activeOrder.tracking || '').trim());

      setIsLoading(true);
      try {
        const res = await fetch('/api/tech/add-serial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tracking: activeOrder.tracking,
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

        setActiveOrder({
          ...activeOrder,
          serialNumbers: data.serialNumbers,
        });

        setSuccessMessage(`Serial ${finalSerial} added ✓ (${data.serialNumbers.length} total)`);

        if (data.isComplete) {
          confetti({ particleCount: 100, spread: 70 });
        }

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
        setActiveOrder({
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
        setActiveOrder(null);
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
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    setIsSearching(true);
    try {
      const normalizedQuery = normalizeTrackingQuery(searchQuery);
      const res = await fetch(`/api/shipped?q=${encodeURIComponent(normalizedQuery)}`);
      const data = await res.json();

      if (data.results) {
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
    setActiveOrder,
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
