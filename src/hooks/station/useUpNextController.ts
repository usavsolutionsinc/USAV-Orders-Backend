import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUpNextData } from '@/hooks/useUpNextData';
import { getOrderPlatformLabel } from '@/utils/order-platform';
import {
  isOutOfStock,
  getRepairSortValue,
  matchesSearch,
  TAB_ORDER,
  SORT_FILTER_IDS,
  QUICK_FILTER_ITEMS,
  type UpNextTabId,
} from '@/utils/upnext-shared';
import type { Order, RepairQueueItem, FBAQueueItem, ReceivingQueueItem } from '@/components/station/upnext/upnext-types';

type TabId = UpNextTabId;

interface UseUpNextControllerOptions {
  techId: string;
  onAllCompleted?: () => void;
  /** Controlled search text — if provided, managed externally. */
  searchTextOverride?: string;
  /** Controlled quick-filter — if provided, managed externally. */
  quickFilterOverride?: string;
}

export function useUpNextController({
  techId,
  onAllCompleted,
  searchTextOverride,
  quickFilterOverride,
}: UseUpNextControllerOptions) {
  const [activeTab, setActiveTab] = useState<TabId>('all');
  const [expandedItemKey, setExpandedItemKey] = useState<string | null>(null);
  const [showMissingPartsInput, setShowMissingPartsInput] = useState<number | null>(null);
  const [missingPartsReason, setMissingPartsReason] = useState('');
  const [internalSearchText, setInternalSearchText] = useState('');
  const [internalQuickFilter, setInternalQuickFilter] = useState('must_go');

  const searchText = searchTextOverride !== undefined ? searchTextOverride : internalSearchText;
  const quickFilter = quickFilterOverride !== undefined ? quickFilterOverride : internalQuickFilter;

  const { allOrders, allRepairs, fbaItems, receivingItems, loading, allCompletedToday, fetchOrders } =
    useUpNextData({ techId, onAllCompleted });

  // ── Data partitioning ─────────────────────────────────────────────────────

  const pendingVisibleOrders = allOrders.filter((order) => !order.has_tech_scan);
  const stockOrders = pendingVisibleOrders.filter(isOutOfStock);
  const nonStockOrders = pendingVisibleOrders.filter((order) => !isOutOfStock(order));
  const sortedRepairs = [...allRepairs].sort(
    (a, b) => getRepairSortValue(a.deadlineAt, a.dateTime) - getRepairSortValue(b.deadlineAt, b.dateTime),
  );
  const activeFbaItems = fbaItems.filter((i) => i.status !== 'SHIPPED');

  const rawTabCounts: Record<TabId, number> = {
    orders: nonStockOrders.length,
    stock: stockOrders.length,
    repair: sortedRepairs.length,
    fba: activeFbaItems.length,
    receiving: receivingItems.length,
    all: nonStockOrders.length + sortedRepairs.length + activeFbaItems.length + receivingItems.length,
  };

  // ── Filtering ─────────────────────────────────────────────────────────────

  const filteredOrders = useMemo(() => {
    let list = nonStockOrders;
    if (quickFilter !== 'all' && !SORT_FILTER_IDS.has(quickFilter)) {
      list = list.filter((o) => {
        const plat = getOrderPlatformLabel(o.order_id || '', o.account_source).toLowerCase();
        if (quickFilter === 'ecwid') return plat === 'ecwid' || (!plat.includes('amazon') && !plat.includes('ebay') && !plat.includes('walmart'));
        return plat.includes(quickFilter);
      });
    }
    if (searchText.trim()) {
      list = list.filter((o) => matchesSearch(searchText, [o.product_title, o.order_id, o.shipping_tracking_number, o.sku, o.condition]));
    }
    return list;
  }, [nonStockOrders, quickFilter, searchText]);

  const filteredStockOrders = useMemo(() => {
    if (!searchText.trim()) return stockOrders;
    return stockOrders.filter((o) => matchesSearch(searchText, [o.product_title, o.order_id, o.shipping_tracking_number, o.sku, o.condition, o.out_of_stock]));
  }, [stockOrders, searchText]);

  const filteredRepairs = useMemo(() => {
    let list = sortedRepairs;
    if (searchText.trim()) {
      list = list.filter((r) => matchesSearch(searchText, [r.productTitle, r.ticketNumber, r.serialNumber, r.sku, r.issue]));
    }
    return list;
  }, [sortedRepairs, searchText]);

  const filteredFbaItems = useMemo(() => {
    let list = activeFbaItems;
    if (quickFilter !== 'all') {
      list = list.filter((i) => i.status === quickFilter);
    }
    if (searchText.trim()) {
      list = list.filter((i) => matchesSearch(searchText, [i.product_title, i.fnsku, i.condition]));
    }
    return list;
  }, [activeFbaItems, quickFilter, searchText]);

  const filteredReceivingItems = useMemo(() => {
    if (!searchText.trim()) return receivingItems;
    return receivingItems.filter((i) => matchesSearch(searchText, [i.tracking_number, i.notes, ...(i.line_skus || [])]));
  }, [receivingItems, searchText]);

  // ── Sorting ───────────────────────────────────────────────────────────────

  const sortedOrders = useMemo(() => {
    if (quickFilter === 'must_go') {
      return [...filteredOrders].sort((a, b) => {
        const da = a.ship_by_date ? new Date(a.ship_by_date).getTime() : Number.POSITIVE_INFINITY;
        const db = b.ship_by_date ? new Date(b.ship_by_date).getTime() : Number.POSITIVE_INFINITY;
        return da - db;
      });
    }
    if (quickFilter === 'newest') {
      return [...filteredOrders].sort((a, b) => {
        const da = a.created_at ? new Date(a.created_at).getTime() : 0;
        const db = b.created_at ? new Date(b.created_at).getTime() : 0;
        return db - da;
      });
    }
    if (quickFilter === 'oldest') {
      return [...filteredOrders].sort((a, b) => {
        const da = a.created_at ? new Date(a.created_at).getTime() : Number.POSITIVE_INFINITY;
        const db = b.created_at ? new Date(b.created_at).getTime() : Number.POSITIVE_INFINITY;
        return da - db;
      });
    }
    return filteredOrders;
  }, [filteredOrders, quickFilter]);

  // ── Visible tabs ──────────────────────────────────────────────────────────

  type VisibleTab = {
    id: TabId;
    label: string;
    count?: number;
    color: 'blue' | 'green' | 'yellow' | 'orange' | 'purple' | 'gray' | 'red' | 'teal';
  };

  const visibleTabs: VisibleTab[] = useMemo(
    () => [
      { id: 'all', label: 'All', color: 'blue', count: rawTabCounts.all || undefined },
      { id: 'orders', label: 'Orders', color: 'green', count: rawTabCounts.orders || undefined },
      ...(rawTabCounts.fba > 0
        ? [{ id: 'fba' as const, label: 'FBA', color: 'purple' as const, count: rawTabCounts.fba }]
        : []),
      ...(rawTabCounts.repair > 0
        ? [{ id: 'repair' as const, label: 'Repair', color: 'orange' as const, count: rawTabCounts.repair }]
        : []),
      ...(rawTabCounts.stock > 0
        ? [{ id: 'stock' as const, label: 'Stock', color: 'red' as const, count: rawTabCounts.stock }]
        : []),
      ...(rawTabCounts.receiving > 0
        ? [{ id: 'receiving' as const, label: 'Receiving', color: 'teal' as const, count: rawTabCounts.receiving }]
        : []),
    ],
    [rawTabCounts.all, rawTabCounts.orders, rawTabCounts.fba, rawTabCounts.repair, rawTabCounts.stock, rawTabCounts.receiving],
  );

  const activeTabVisible = visibleTabs.some((tab) => tab.id === activeTab);
  const effectiveTab = activeTabVisible ? activeTab : visibleTabs[0]?.id || 'orders';

  // ── Tab auto-management ───────────────────────────────────────────────────

  const selectTab = useCallback((next: TabId) => setActiveTab(next), []);

  useEffect(() => {
    if (activeTabVisible || effectiveTab === activeTab) return;
    selectTab(effectiveTab);
  }, [activeTabVisible, effectiveTab, activeTab, selectTab]);

  useEffect(() => {
    setExpandedItemKey(null);
    setShowMissingPartsInput(null);
    setMissingPartsReason('');
    if (searchTextOverride === undefined) setInternalSearchText('');
    if (quickFilterOverride === undefined) setInternalQuickFilter(QUICK_FILTER_ITEMS[effectiveTab]?.[0]?.id ?? 'all');
  }, [effectiveTab, searchTextOverride, quickFilterOverride]);

  useEffect(() => {
    if (effectiveTab === 'all' || effectiveTab === 'orders') return;
    if (rawTabCounts[effectiveTab] > 0) return;
    const next = TAB_ORDER.find((id) => rawTabCounts[id] > 0);
    if (next && next !== activeTab) selectTab(next);
  }, [effectiveTab, rawTabCounts, activeTab, selectTab]);

  // ── Urgency breakdown ─────────────────────────────────────────────────────

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lateCount = filteredOrders.filter((o) => {
    const d = o.ship_by_date ? new Date(o.ship_by_date) : null;
    return d && d < today;
  }).length;
  const dueTodayCount = filteredOrders.filter((o) => {
    const d = o.ship_by_date ? new Date(o.ship_by_date) : null;
    if (!d) return false;
    d.setHours(0, 0, 0, 0);
    return d.getTime() === today.getTime();
  }).length;

  const shouldShowStockSection = stockOrders.length > 0 && effectiveTab !== 'stock';
  const showNoCurrentOrdersBanner = allCompletedToday && filteredOrders.length === 0 && filteredStockOrders.length === 0;

  // ── Interactions ──────────────────────────────────────────────────────────

  const toggleExpandedItem = useCallback((key: string) => {
    setExpandedItemKey((prev) => (prev === key ? null : key));
  }, []);

  return {
    // Tab state
    activeTab,
    effectiveTab,
    visibleTabs,
    selectTab,
    rawTabCounts,

    // Search / filter
    searchText,
    setSearchText: setInternalSearchText,
    quickFilter,
    setQuickFilter: setInternalQuickFilter,

    // Filtered + sorted data
    sortedOrders,
    filteredOrders,
    filteredStockOrders,
    filteredRepairs,
    filteredFbaItems,
    filteredReceivingItems,
    nonStockOrders,
    stockOrders,
    activeFbaItems,

    // Raw data
    allOrders,
    allRepairs,
    receivingItems,
    loading,
    allCompletedToday,
    fetchOrders,

    // Expansion
    expandedItemKey,
    toggleExpandedItem,

    // Missing parts
    showMissingPartsInput,
    setShowMissingPartsInput,
    missingPartsReason,
    setMissingPartsReason,

    // Derived
    lateCount,
    dueTodayCount,
    shouldShowStockSection,
    showNoCurrentOrdersBanner,
  };
}

export type UseUpNextControllerReturn = ReturnType<typeof useUpNextController>;
