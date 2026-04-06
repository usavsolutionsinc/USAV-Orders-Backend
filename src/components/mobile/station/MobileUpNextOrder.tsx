'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { framerPresence, framerTransition, tabPagerVariants } from '@/design-system';
import confetti from 'canvas-confetti';
import { Package } from '@/components/Icons';
import { TabSwitch } from '@/components/ui/TabSwitch';
import { getTechStationLightChromeOutlineClass } from '@/utils/staff-colors';
import { SLIDER_PRESETS, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { useUpNextController } from '@/hooks/station/useUpNextController';

// Mobile-optimized cards with 44px+ touch targets and rounded card styling
import { MobileOrderCard as OrderCard } from './upnext/MobileOrderCard';
import { MobileRepairCard as RepairCard } from './upnext/MobileRepairCard';
import { MobileFbaItemCard as FbaItemCard } from './upnext/MobileFbaItemCard';
import { MobileReceivingCard as ReceivingAssignmentCard } from './upnext/MobileReceivingCard';
import {
  isOutOfStock,
  getRepairSortValue,
  matchesSearch,
  TAB_ORDER,
  SORT_FILTER_IDS,
  QUICK_FILTER_ITEMS,
  type UpNextTabId,
} from '@/utils/upnext-shared';

// ─── Types ───────────────────────────────────────────────────────────────────

type TabId = UpNextTabId;

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
  const [tabSlideDir, setTabSlideDir] = useState(1);
  const prefersReducedMotion = useReducedMotion();
  const hasCelebratedRef = useRef(false);

  const ctrl = useUpNextController({
    techId,
    onAllCompleted,
    searchTextOverride: searchTextProp,
    quickFilterOverride: quickFilterProp,
  });
  const {
    effectiveTab, visibleTabs, rawTabCounts,
    searchText, quickFilter,
    sortedOrders, filteredOrders, filteredStockOrders, filteredRepairs,
    filteredFbaItems, filteredReceivingItems,
    nonStockOrders, stockOrders,
    loading, allCompletedToday, fetchOrders,
    expandedItemKey, toggleExpandedItem,
    showMissingPartsInput, setShowMissingPartsInput,
    missingPartsReason, setMissingPartsReason,
    lateCount, dueTodayCount, shouldShowStockSection, showNoCurrentOrdersBanner,
  } = ctrl;
  const tabCounts = rawTabCounts;
  const stationTabChromeOutline = useMemo(() => getTechStationLightChromeOutlineClass(techId), [techId]);

  const visibleTabBarIndex = useCallback(
    (id: TabId) => {
      const v = visibleTabs.findIndex((t) => t.id === id);
      if (v >= 0) return v;
      const o = TAB_ORDER.indexOf(id);
      return o >= 0 ? o : 0;
    },
    [visibleTabs],
  );

  const tabTransition = prefersReducedMotion ? framerTransition.tabPagerReduced : framerTransition.tabPager;

  const selectTab = useCallback(
    (next: TabId, fromTab?: TabId) => {
      const from = visibleTabBarIndex(fromTab ?? effectiveTab);
      const to = visibleTabBarIndex(next);
      setTabSlideDir(to >= from ? 1 : -1);
      ctrl.selectTab(next);
    },
    [effectiveTab, visibleTabBarIndex, ctrl],
  );

  // Notify parent when effective tab changes (mobile filter pills sync)
  useEffect(() => {
    const items = QUICK_FILTER_ITEMS[effectiveTab] ?? [];
    const variant: 'fba' | 'slate' = items.some((i) => i.tone) ? 'fba' : 'slate';
    onEffectiveTabChange?.(items, variant);
  }, [effectiveTab]); // eslint-disable-line react-hooks/exhaustive-deps


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

  const handleToggleExpand = (key: string) => {
    toggleExpandedItem(key);
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
        if (expandedItemKey !== (key || `order-${order.id}`)) toggleExpandedItem(key || `order-${order.id}`);
        setShowMissingPartsInput(showMissingPartsInput === id ? null : id);
      }}
      onMissingPartsReasonChange={setMissingPartsReason}
      onMissingPartsSubmit={handleMissingParts}
      onMissingPartsCancel={() => setShowMissingPartsInput(null)}
      isExpanded={expandedItemKey === (key || `order-${order.id}`)}
      onToggleExpand={() => handleToggleExpand(key || `order-${order.id}`)}
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
              onToggleExpand={() => handleToggleExpand(`fba-${item.item_id}`)}
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
              onToggleExpand={() => handleToggleExpand(`repair-${repair.repairId}`)}
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
                        onToggleExpand={() => handleToggleExpand(`repair-${repair.repairId}`)}
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
                        onToggleExpand={() => handleToggleExpand(`fba-${item.item_id}`)}
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
                            onToggleExpand={() => handleToggleExpand(`repair-${repair.repairId}`)}
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
