'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { framerPresence, framerTransition, tabPagerVariants } from '@/design-system';
import confetti from 'canvas-confetti';
import { Package } from '@/components/Icons';
import { TabSwitch } from '@/components/ui/TabSwitch';
import { useUpNextData } from '@/hooks/useUpNextData';
import { getTechStationLightChromeOutlineClass } from '@/utils/staff-colors';
import { getOrderPlatformLabel } from '@/utils/order-platform';
import { SLIDER_PRESETS, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';

// Mobile-optimized cards with 44px+ touch targets and rounded card styling
import { MobileOrderCard as OrderCard } from './upnext/MobileOrderCard';
import { MobileRepairCard as RepairCard } from './upnext/MobileRepairCard';
import { MobileFbaItemCard as FbaItemCard } from './upnext/MobileFbaItemCard';
import { MobileReceivingCard as ReceivingAssignmentCard } from './upnext/MobileReceivingCard';

// ─── Types ───────────────────────────────────────────────────────────────────

type TabId = 'all' | 'orders' | 'repair' | 'fba' | 'stock' | 'receiving';

interface MobileUpNextOrderProps {
  techId: string;
  onStart: (tracking: string) => void;
  onMissingParts: (orderId: number, reason: string) => void;
  onAllCompleted?: () => void;
  /** Controlled search text — if omitted, managed internally */
  searchText?: string;
  /** Controlled quick-filter value — if omitted, managed internally */
  quickFilter?: string;
  /**
   * Called whenever the effective tab changes.
   * Parent uses this to sync the filter pills in MobileSearchOverlay.
   */
  onEffectiveTabChange?: (items: HorizontalSliderItem[], variant: 'fba' | 'slate') => void;
}

// ─── Helpers (same as desktop UpNextOrder) ──────────────────────────────────

function isOutOfStock(order: { out_of_stock: string | null }): boolean {
  return !!String(order.out_of_stock || '').trim();
}

function getRepairSortValue(deadlineAt: string | null | undefined, fallbackDateTime?: string | null | undefined): number {
  const source = deadlineAt || fallbackDateTime;
  if (!source) return Number.POSITIVE_INFINITY;
  try {
    const parsed = typeof source === 'string' && source.startsWith('"') ? JSON.parse(source) : source;
    const value = typeof parsed === 'object' && parsed?.start ? parsed.start : parsed;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const TAB_ORDER: TabId[] = ['all', 'orders', 'fba', 'repair', 'stock', 'receiving'];

function matchesSearch(needle: string, fields: (string | null | undefined)[]): boolean {
  const trimmed = needle.trim();
  if (!trimmed) return true;
  const tokens = trimmed.toLowerCase().split(/\s+/);
  const haystack = fields.map((f) => (f || '').toLowerCase()).join(' ');
  return tokens.every((t) => haystack.includes(t));
}

const SORT_FILTER_IDS = new Set(['must_go', 'newest', 'oldest']);

const QUICK_FILTER_ITEMS: Record<TabId, HorizontalSliderItem[]> = {
  all:       [SLIDER_PRESETS.mustGo, SLIDER_PRESETS.newest, SLIDER_PRESETS.oldest],
  orders:    [SLIDER_PRESETS.all, SLIDER_PRESETS.amazon, SLIDER_PRESETS.ebay, SLIDER_PRESETS.ecwid],
  fba:       [SLIDER_PRESETS.pending],
  repair:    [SLIDER_PRESETS.repair],
  stock:     [SLIDER_PRESETS.stock],
  receiving: [SLIDER_PRESETS.receiving],
};

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * MobileUpNextOrder — mobile variant of UpNextOrder.
 *
 * Key mobile differences:
 * - Filter bar rendered inline at bottom of the list (no portal)
 * - Cards use full width with mobile touch targets
 * - Tab bar scrolls horizontally
 * - No filterBarPortalRef needed
 */
export function MobileUpNextOrder({
  techId,
  onStart,
  onMissingParts,
  onAllCompleted,
  searchText: searchTextProp,
  quickFilter: quickFilterProp,
  onEffectiveTabChange,
}: MobileUpNextOrderProps) {
  const [activeTab, setActiveTab] = useState<TabId>('all');
  const [tabSlideDir, setTabSlideDir] = useState(1);
  const [expandedItemKey, setExpandedItemKey] = useState<string | null>(null);
  const prefersReducedMotion = useReducedMotion();
  const [showMissingPartsInput, setShowMissingPartsInput] = useState<number | null>(null);
  const [missingPartsReason, setMissingPartsReason] = useState('');
  // Internal fallback state — used only when props are not provided
  const [internalSearchText, setInternalSearchText] = useState('');
  const [internalQuickFilter, setInternalQuickFilter] = useState('must_go');
  const searchText = searchTextProp !== undefined ? searchTextProp : internalSearchText;
  const quickFilter = quickFilterProp !== undefined ? quickFilterProp : internalQuickFilter;
  const hasCelebratedRef = useRef(false);

  const { allOrders, allRepairs, fbaItems, receivingItems, loading, allCompletedToday, fetchOrders } =
    useUpNextData({ techId, onAllCompleted });

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

  const tabCounts = rawTabCounts;
  const stationTabChromeOutline = useMemo(() => getTechStationLightChromeOutlineClass(techId), [techId]);

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

  const visibleTabBarIndex = useCallback(
    (id: TabId) => {
      const v = visibleTabs.findIndex((t) => t.id === id);
      if (v >= 0) return v;
      const o = TAB_ORDER.indexOf(id);
      return o >= 0 ? o : 0;
    },
    [visibleTabs],
  );

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

  const tabTransition = prefersReducedMotion ? framerTransition.tabPagerReduced : framerTransition.tabPager;

  const selectTab = useCallback(
    (next: TabId, fromTab?: TabId) => {
      const from = visibleTabBarIndex(fromTab ?? effectiveTab);
      const to = visibleTabBarIndex(next);
      setTabSlideDir(to >= from ? 1 : -1);
      setActiveTab(next);
    },
    [effectiveTab, visibleTabBarIndex],
  );

  const shouldShowStockSection = stockOrders.length > 0 && effectiveTab !== 'stock';
  const showNoCurrentOrdersBanner = allCompletedToday && filteredOrders.length === 0 && filteredStockOrders.length === 0;

  useEffect(() => {
    if (activeTabVisible || effectiveTab === activeTab) return;
    selectTab(effectiveTab, activeTab);
  }, [activeTabVisible, effectiveTab, activeTab, selectTab]);

  useEffect(() => {
    setExpandedItemKey(null);
    setShowMissingPartsInput(null);
    setMissingPartsReason('');
    const items = QUICK_FILTER_ITEMS[effectiveTab] ?? [];
    const variant: 'fba' | 'slate' = items.some((i) => i.tone) ? 'fba' : 'slate';
    // Reset internal state only when uncontrolled
    if (searchTextProp === undefined) setInternalSearchText('');
    if (quickFilterProp === undefined) setInternalQuickFilter(items[0]?.id ?? 'all');
    // Notify parent so MobileSearchOverlay can update its pills
    onEffectiveTabChange?.(items, variant);
  }, [effectiveTab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (effectiveTab === 'all' || effectiveTab === 'orders') return;
    if (tabCounts[effectiveTab] > 0) return;
    const next = TAB_ORDER.find((id) => tabCounts[id] > 0);
    if (next && next !== activeTab) selectTab(next, effectiveTab);
  }, [effectiveTab, activeTab, tabCounts, selectTab]);

  useEffect(() => {
    const isCompletionView = (effectiveTab === 'orders' || effectiveTab === 'all') && showNoCurrentOrdersBanner;
    if (isCompletionView && !hasCelebratedRef.current) {
      confetti({ particleCount: 180, spread: 80, origin: { y: 0.7 } });
      hasCelebratedRef.current = true;
      return;
    }
    if (!isCompletionView) hasCelebratedRef.current = false;
  }, [effectiveTab, showNoCurrentOrdersBanner]);

  const handleStart = async (order: { id: number; shipping_tracking_number: string; order_id: string }) => {
    try {
      const res = await fetch('/api/orders/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, techId }),
      });
      if (res.ok) {
        onStart(order.shipping_tracking_number || order.order_id);
        fetchOrders();
      }
    } catch (error) {
      console.error('Error starting order:', error);
    }
  };

  const handleMissingParts = async (orderId: number) => {
    if (!missingPartsReason.trim()) return;
    try {
      const res = await fetch('/api/orders/missing-parts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, reason: missingPartsReason.trim() }),
      });
      if (res.ok) {
        onMissingParts(orderId, missingPartsReason.trim());
        setShowMissingPartsInput(null);
        setMissingPartsReason('');
        fetchOrders();
      }
    } catch (error) {
      console.error('Error marking missing parts:', error);
    }
  };

  const toggleExpandedItem = (key: string) => {
    setExpandedItemKey((current) => (current === key ? null : key));
    if (showMissingPartsInput !== null) {
      setShowMissingPartsInput(null);
      setMissingPartsReason('');
    }
  };

  const renderOrderCard = (order: any, key?: string, effectiveOrderTab?: 'orders' | 'stock') => (
    <OrderCard
      key={key || order.id}
      order={order}
      effectiveTab={effectiveOrderTab || effectiveTab}
      techId={techId}
      showMissingPartsInput={showMissingPartsInput}
      missingPartsReason={missingPartsReason}
      onStart={handleStart}
      onMissingPartsToggle={(id) => {
        setExpandedItemKey(key || `order-${order.id}`);
        setShowMissingPartsInput(showMissingPartsInput === id ? null : id);
      }}
      onMissingPartsReasonChange={setMissingPartsReason}
      onMissingPartsSubmit={handleMissingParts}
      onMissingPartsCancel={() => setShowMissingPartsInput(null)}
      isExpanded={expandedItemKey === (key || `order-${order.id}`)}
      onToggleExpand={() => toggleExpandedItem(key || `order-${order.id}`)}
    />
  );

  const isFiltering = Boolean(searchText.trim() || (quickFilter !== 'all' && !SORT_FILTER_IDS.has(quickFilter)));
  const Wrap = isFiltering
    ? ({ children }: { children: React.ReactNode }) => <>{children}</>
    : ({ children }: { children: React.ReactNode }) => <AnimatePresence mode="popLayout">{children}</AnimatePresence>;

  const allSections = [
    {
      id: 'orders',
      label: 'Pending Orders',
      headerColor: 'orange' as const,
      count: sortedOrders.length,
      render: () => <Wrap>{sortedOrders.map((order) => renderOrderCard(order))}</Wrap>,
    },
    {
      id: 'fba',
      label: 'FBA Pending Items',
      headerColor: 'purple' as const,
      count: filteredFbaItems.length,
      render: () => (
        <Wrap>
          {filteredFbaItems.map((item) => (
            <FbaItemCard
              key={item.item_id}
              item={item}
              isExpanded={expandedItemKey === `fba-${item.item_id}`}
              onToggleExpand={() => toggleExpandedItem(`fba-${item.item_id}`)}
            />
          ))}
        </Wrap>
      ),
    },
    {
      id: 'repair',
      label: 'Repair Service',
      headerColor: 'orange' as const,
      count: filteredRepairs.length,
      render: () => (
        <Wrap>
          {filteredRepairs.map((repair) => (
            <RepairCard
              key={`repair-${repair.repairId}`}
              repair={repair}
              techId={techId}
              isExpanded={expandedItemKey === `repair-${repair.repairId}`}
              onToggleExpand={() => toggleExpandedItem(`repair-${repair.repairId}`)}
            />
          ))}
        </Wrap>
      ),
    },
    {
      id: 'receiving',
      label: 'Receiving',
      headerColor: 'orange' as const,
      count: filteredReceivingItems.length,
      render: () => (
        <Wrap>
          {filteredReceivingItems.map((item) => (
            <ReceivingAssignmentCard key={item.assignment_id} item={item} />
          ))}
        </Wrap>
      ),
    },
  ].filter((section) => section.count > 0);

  if (loading) {
    return (
      <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-24 mb-3" />
        <div className="h-24 bg-gray-200 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="relative flex flex-col space-y-1.5">
      {/* ── Tab bar (scrollable, touch-friendly) ── */}
      <TabSwitch
        tabs={visibleTabs}
        activeTab={effectiveTab}
        onTabChange={(tab) => selectTab(tab as TabId)}
        scrollable
        variant="upNext"
        stationChromeOutlineClassName={stationTabChromeOutline}
      />

      {/* ── Urgency summary bar ── */}
      <AnimatePresence initial={false}>
        {tabCounts.all > 0 && (lateCount > 0 || dueTodayCount > 0) && (
          <motion.div
            {...framerPresence.collapseHeight}
            transition={framerTransition.upNextCollapse}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 px-1 pt-0.5">
              {lateCount > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-red-500">
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                  {lateCount} late
                </span>
              )}
              {lateCount > 0 && dueTodayCount > 0 && (
                <span className="text-gray-500 text-[10px]">·</span>
              )}
              {dueTodayCount > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-amber-500">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                  {dueTodayCount} due today
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Tab content ── */}
      <div className="grid overflow-hidden">
        <AnimatePresence mode="sync" initial={false} custom={tabSlideDir}>
          <motion.div
            key={effectiveTab}
            custom={tabSlideDir}
            variants={tabPagerVariants}
            initial={prefersReducedMotion ? false : 'enter'}
            animate="center"
            exit="exit"
            transition={tabTransition}
            className="col-start-1 row-start-1 min-w-0 w-full will-change-transform"
            style={{ backfaceVisibility: 'hidden' }}
          >
            {effectiveTab === 'stock' ? (
              filteredStockOrders.length === 0 ? (
                <EmptySlate label={isFiltering ? 'No results' : 'No out-of-stock orders'} color="red" />
              ) : (
                <div className="flex flex-col">
                  <Wrap>
                    {filteredStockOrders.map((order) => renderOrderCard(order, `stock-${order.id}`, 'stock'))}
                  </Wrap>
                </div>
              )
            ) : effectiveTab === 'all' ? (
              allSections.length === 0 ? (
                isFiltering ? (
                  <EmptySlate label="No results" color="gray" />
                ) : showNoCurrentOrdersBanner ? (
                  <EmptySlate label="No current orders" color="green" />
                ) : (
                  <EmptySlate label="No current work" color="green" />
                )
              ) : (
                <div className="flex flex-col">
                  {showNoCurrentOrdersBanner && (
                    <div className="mb-3">
                      <EmptySlate label="No current orders" color="green" />
                    </div>
                  )}
                  {allSections.map((section, index) => (
                    <div key={section.id} className={index === 0 ? '' : 'mt-3'}>
                      {(index > 0 || showNoCurrentOrdersBanner) && (
                        <SectionHeader label={section.label} color={section.headerColor} />
                      )}
                      <div className="flex flex-col">{section.render()}</div>
                    </div>
                  ))}
                </div>
              )
            ) : effectiveTab === 'repair' ? (
              filteredRepairs.length === 0 ? (
                <EmptySlate label={isFiltering ? 'No results' : 'No repairs in queue'} />
              ) : (
                <div className="flex flex-col">
                  <Wrap>
                    {filteredRepairs.map((repair) => (
                      <RepairCard
                        key={repair.repairId}
                        repair={repair}
                        techId={techId}
                        isExpanded={expandedItemKey === `repair-${repair.repairId}`}
                        onToggleExpand={() => toggleExpandedItem(`repair-${repair.repairId}`)}
                      />
                    ))}
                  </Wrap>
                </div>
              )
            ) : effectiveTab === 'fba' ? (
              filteredFbaItems.length === 0 ? (
                <EmptySlate label={isFiltering ? 'No results' : 'No active FBA items'} color={isFiltering ? 'gray' : 'purple'} />
              ) : (
                <div className="flex flex-col">
                  <Wrap>
                    {filteredFbaItems.map((item) => (
                      <FbaItemCard
                        key={item.item_id}
                        item={item}
                        isExpanded={expandedItemKey === `fba-${item.item_id}`}
                        onToggleExpand={() => toggleExpandedItem(`fba-${item.item_id}`)}
                      />
                    ))}
                  </Wrap>
                </div>
              )
            ) : effectiveTab === 'receiving' ? (
              filteredReceivingItems.length === 0 ? (
                <EmptySlate label={isFiltering ? 'No results' : 'No receiving items assigned'} color={isFiltering ? 'gray' : 'teal'} />
              ) : (
                <div className="flex flex-col">
                  <Wrap>
                    {filteredReceivingItems.map((item) => (
                      <ReceivingAssignmentCard key={item.assignment_id} item={item} />
                    ))}
                  </Wrap>
                </div>
              )
            ) : filteredOrders.length === 0 ? (
              <div className="flex flex-col">
                <EmptySlate label={isFiltering ? 'No results' : 'No current orders'} color={isFiltering ? 'gray' : 'green'} />
                {!isFiltering && filteredRepairs.length > 0 && (
                  <div className="mt-3">
                    <SectionHeader label="Repair Service" />
                    <div className="flex flex-col">
                      <Wrap>
                        {filteredRepairs.map((repair) => (
                          <RepairCard
                            key={`orders-repair-${repair.repairId}`}
                            repair={repair}
                            techId={techId}
                            isExpanded={expandedItemKey === `repair-${repair.repairId}`}
                            onToggleExpand={() => toggleExpandedItem(`repair-${repair.repairId}`)}
                          />
                        ))}
                      </Wrap>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col">
                <Wrap>{filteredOrders.map((order) => renderOrderCard(order))}</Wrap>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {shouldShowStockSection && (
        <div className="mt-3">
          <div className="flex items-center gap-2 px-1 py-1.5 mb-1">
            <div className="h-px flex-1 bg-orange-200" />
            <span className="text-[10px] font-black uppercase tracking-widest text-orange-600">Out Of Stock</span>
            <div className="h-px flex-1 bg-orange-200" />
          </div>
          <div className="flex flex-col">
            <Wrap>{filteredStockOrders.map((order) => renderOrderCard(order, `stock-${order.id}`, 'stock'))}</Wrap>
          </div>
        </div>
      )}

    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function EmptySlate({ label, color = 'gray' }: { label: string; color?: 'gray' | 'green' | 'purple' | 'teal' | 'red' }) {
  const bg = color === 'green' ? 'bg-emerald-50 border-emerald-100' : color === 'purple' ? 'bg-purple-50 border-purple-100' : color === 'teal' ? 'bg-teal-50 border-teal-100' : color === 'red' ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-200';
  const text = color === 'green' ? 'text-emerald-500' : color === 'purple' ? 'text-purple-500' : color === 'teal' ? 'text-teal-500' : color === 'red' ? 'text-red-500' : 'text-gray-500';
  const icon = color === 'green' ? 'text-emerald-300' : color === 'purple' ? 'text-purple-200' : color === 'teal' ? 'text-teal-200' : color === 'red' ? 'text-red-200' : 'text-gray-500';
  return (
    <motion.div
      {...framerPresence.upNextRow}
      transition={framerTransition.upNextRowMount}
      className={`rounded-2xl px-4 py-4 border ${bg}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={`text-sm font-bold uppercase tracking-widest ${text}`}>{label}</p>
        <Package className={`w-6 h-6 flex-shrink-0 ${icon}`} />
      </div>
    </motion.div>
  );
}

function SectionHeader({ label, color = 'orange' }: { label: string; color?: 'orange' | 'purple' | 'red' }) {
  const lineClass = color === 'purple' ? 'bg-purple-200' : color === 'red' ? 'bg-red-200' : 'bg-orange-200';
  const textClass = color === 'purple' ? 'text-purple-600' : color === 'red' ? 'text-red-600' : 'text-orange-600';
  return (
    <div className="flex items-center gap-2 px-1 py-2 mb-1">
      <div className={`h-px flex-1 ${lineClass}`} />
      <span className={`text-[10px] font-black uppercase tracking-widest ${textClass}`}>{label}</span>
      <div className={`h-px flex-1 ${lineClass}`} />
    </div>
  );
}
