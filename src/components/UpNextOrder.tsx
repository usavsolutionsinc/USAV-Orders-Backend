'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { framerPresence, framerTransition, framerVariants, SkeletonList } from '@/design-system';
import confetti from 'canvas-confetti';
import { AlertCircle, ClipboardList, List, Package, ShoppingCart, Wrench } from './Icons';
import { OrderCard } from './station/upnext/OrderCard';
import { RepairCard } from './station/upnext/RepairCard';
import { FbaItemCard } from './station/upnext/FbaItemCard';
import { ReceivingAssignmentCard } from './station/upnext/ReceivingAssignmentCard';
import { UpNextFilterBar } from './station/upnext/UpNextFilterBar';
import { HorizontalButtonSlider, SLIDER_PRESETS, type HorizontalSliderItem } from './ui/HorizontalButtonSlider';
import { QUICK_FILTER_ITEMS, SORT_FILTER_IDS, type UpNextTabId } from '@/utils/upnext-shared';
import { useUpNextController } from '@/hooks/station/useUpNextController';
import type { UpNextPreviewPayload } from '@/utils/events';
import type { ActiveStationOrder } from '@/hooks/useStationTestingController';

/** Tab → icon mapping for the Up Next slider (nav variant). Keeps the bar
 *  visually consistent with the global sidebar's view switcher. */
const UP_NEXT_TAB_ICONS: Record<UpNextTabId, (props: { className?: string }) => JSX.Element> = {
  all: List,
  orders: ShoppingCart,
  fba: Package,
  repair: Wrench,
  stock: AlertCircle,
  receiving: ClipboardList,
};

/**
 * Two separate hide-sets for two different concerns. Keeping rendering logic
 * intact means flipping a single entry brings a feature back.
 *
 * `HIDDEN_PILL_IDS` — pills hidden from the slider only.
 *   - `fba` + `repair`: queued for a redesign, out of view for now.
 *   - `all` + `orders`: with FBA + Repair hidden these two pills show the
 *     same content (orders), so the second pill is redundant. The "all"
 *     view still renders below; we just don't draw the duplicate pills.
 *
 * `HIDDEN_SECTION_IDS` — sections hidden from the "all"-view section list.
 *   Only the categories whose CONTENT we don't want to render belong here
 *   (FBA + Repair). `orders` must NOT be hidden as a section, otherwise the
 *   "all" view ends up empty even though `filteredOrders` is populated —
 *   that was the bug behind "9 late but no cards".
 */
const HIDDEN_PILL_IDS = new Set<UpNextTabId>(['fba', 'repair', 'all', 'orders']);
const HIDDEN_SECTION_IDS = new Set<UpNextTabId>(['fba', 'repair']);

type TabId = UpNextTabId;

interface UpNextOrderProps {
  techId: string;
  onStart: (tracking: string) => void;
  onMissingParts: (orderId: number, reason: string) => void;
  onAllCompleted?: () => void;
  filterBarPortalRef?: React.RefObject<HTMLDivElement | null>;
}


export default function UpNextOrder({ techId, onStart, onMissingParts, onAllCompleted, filterBarPortalRef }: UpNextOrderProps) {
  const hasCelebratedRef = useRef(false);

  // ── Selected order — mirrors what's showing in the right pane workspace.
  // Set on preview-click, cleared when a scan resolves into an active order
  // (the active order itself is no longer in the Up Next list, so there's
  // nothing left to highlight in this surface).
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  useEffect(() => {
    const handlePreview = (e: Event) => {
      const detail = (e as CustomEvent<UpNextPreviewPayload>).detail;
      setSelectedOrderId(detail && detail.kind === 'order' ? detail.order.id : null);
    };
    const handleActive = (e: Event) => {
      const detail = (e as CustomEvent<{ activeOrder: ActiveStationOrder } | null>).detail;
      // Any active order takes priority; clear preview selection.
      if (detail) setSelectedOrderId(null);
    };
    window.addEventListener('tech-upnext-preview', handlePreview);
    window.addEventListener('tech-active-order-changed', handleActive);
    return () => {
      window.removeEventListener('tech-upnext-preview', handlePreview);
      window.removeEventListener('tech-active-order-changed', handleActive);
    };
  }, []);

  const ctrl = useUpNextController({ techId, onAllCompleted });

  // Destructure controller for convenience
  const {
    effectiveTab, visibleTabs, selectTab, rawTabCounts,
    searchText, setSearchText, quickFilter, setQuickFilter,
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
  const orders = nonStockOrders;

  // Map controller-supplied tabs to HorizontalButtonSlider's `nav` shape:
  // icons + counts; uniform blue active state matches the global sidebar.
  // Pills hidden per HIDDEN_PILL_IDS (does NOT affect "all"-view content).
  const sliderItems: HorizontalSliderItem[] = useMemo(
    () =>
      visibleTabs
        .filter((tab) => !HIDDEN_PILL_IDS.has(tab.id as UpNextTabId))
        .map((tab) => ({
          id: tab.id,
          label: tab.label,
          count: tab.count,
          icon: UP_NEXT_TAB_ICONS[tab.id as UpNextTabId],
        })),
    [visibleTabs],
  );

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
      isSelected={selectedOrderId === order.id}
    />
  );

  const isFiltering = Boolean(searchText.trim() || (quickFilter !== 'all' && !SORT_FILTER_IDS.has(quickFilter)));
  const renderRows = useCallback(
    (children: React.ReactNode) => (
      isFiltering ? (
        <div className="flex flex-col">
          {children}
        </div>
      ) : (
        <motion.div
          variants={framerVariants.staggeredList}
          initial="initial"
          animate="animate"
          exit="exit"
          className="flex flex-col"
        >
          <AnimatePresence initial={false} mode="popLayout">
            {children}
          </AnimatePresence>
        </motion.div>
      )
    ),
    [isFiltering],
  );

  const allSections = [
    {
      id: 'orders',
      label: 'Pending Orders',
      headerColor: 'orange' as const,
      count: sortedOrders.length,
      render: () => (
        <>
          {sortedOrders.map((order) => renderOrderCard(order))}
        </>
      ),
    },
    {
      id: 'fba',
      label: 'FBA Plan Items',
      headerColor: 'purple' as const,
      count: filteredFbaItems.length,
      render: () => (
        <>
          {filteredFbaItems.map((item) => (
            <FbaItemCard
              key={item.item_id}
              item={item}
              isExpanded={expandedItemKey === `fba-${item.item_id}`}
              onToggleExpand={() => toggleExpandedItem(`fba-${item.item_id}`)}
            />
          ))}
        </>
      ),
    },
    {
      id: 'repair',
      label: 'Repair Service',
      headerColor: 'orange' as const,
      count: filteredRepairs.length,
      render: () => (
        <>
          {filteredRepairs.map((repair) => (
            <RepairCard
              key={`repair-${repair.repairId}`}
              repair={repair}
              techId={techId}
              isExpanded={expandedItemKey === `repair-${repair.repairId}`}
              onToggleExpand={() => toggleExpandedItem(`repair-${repair.repairId}`)}
            />
          ))}
        </>
      ),
    },
    {
      id: 'receiving',
      label: 'Receiving',
      headerColor: 'orange' as const,
      count: filteredReceivingItems.length,
      render: () => (
        <>
          {filteredReceivingItems.map((item) => (
            <ReceivingAssignmentCard key={item.assignment_id} item={item} />
          ))}
        </>
      ),
    },
  ].filter((section) => section.count > 0 && !HIDDEN_SECTION_IDS.has(section.id as UpNextTabId));

  if (loading) {
    return (
      <div className="flex flex-col gap-1">
        <div className="h-10 w-full bg-white mb-2 flex gap-2 overflow-x-hidden px-1">
          <div className="h-8 w-16 bg-gray-100 rounded-full animate-pulse flex-shrink-0" />
          <div className="h-8 w-20 bg-gray-100 rounded-full animate-pulse flex-shrink-0" />
          <div className="h-8 w-20 bg-gray-100 rounded-full animate-pulse flex-shrink-0" />
        </div>
        <SkeletonList count={4} type="card" />
      </div>
    );
  }

  return (
    <div className="relative flex flex-col">
        {/* ── Sticky tab bar — pinned above scrolling card list. Uses the
              shared HorizontalButtonSlider (nav variant) so /tech's Up Next
              switcher matches the global sidebar's view switcher.
              Suppressed entirely when no tabs survive HIDDEN_UP_NEXT_TAB_IDS
              filtering (e.g., when only orders are present). ── */}
        <div className="sticky top-0 z-10 bg-white pb-1.5">
          {sliderItems.length > 0 ? (
            <HorizontalButtonSlider
              items={sliderItems}
              value={effectiveTab}
              onChange={(id) => selectTab(id as TabId)}
              variant="nav"
              aria-label="Up Next tabs"
            />
          ) : null}

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
                    <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-red-500">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
                      {lateCount} late
                    </span>
                  )}
                  {lateCount > 0 && dueTodayCount > 0 && (
                    <span className="text-gray-500 text-[9px]">·</span>
                  )}
                  {dueTodayCount > 0 && (
                    <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-amber-500">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
                      {dueTodayCount} due today
                    </span>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Primary tab content ── */}
        <div>
            {effectiveTab === 'stock' ? (
              filteredStockOrders.length === 0 ? (
                <EmptySlate label={isFiltering ? "No results" : "No out-of-stock orders"} color="red" />
              ) : (
                renderRows(
                  filteredStockOrders.map((order) => (
                    renderOrderCard(order, `stock-${order.id}`, 'stock')
                  ))
                )
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
                <>
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
                      {renderRows(section.render())}
                    </div>
                  ))}
                </>
              )

            ) : effectiveTab === 'repair' ? (
              filteredRepairs.length === 0 ? (
                <EmptySlate label={isFiltering ? "No results" : "No repairs in queue"} />
              ) : (
                renderRows(
                  filteredRepairs.map((repair) => (
                    <RepairCard
                      key={repair.repairId}
                      repair={repair}
                      techId={techId}
                      isExpanded={expandedItemKey === `repair-${repair.repairId}`}
                      onToggleExpand={() => toggleExpandedItem(`repair-${repair.repairId}`)}
                    />
                  ))
                )
              )

            ) : effectiveTab === 'fba' ? (
              filteredFbaItems.length === 0 ? (
                <EmptySlate label={isFiltering ? "No results" : "No FBA plan items"} color={isFiltering ? "gray" : "purple"} />
              ) : (
                renderRows(
                  filteredFbaItems.map((item) => (
                    <FbaItemCard
                      key={item.item_id}
                      item={item}
                      isExpanded={expandedItemKey === `fba-${item.item_id}`}
                      onToggleExpand={() => toggleExpandedItem(`fba-${item.item_id}`)}
                    />
                  ))
                )
              )

            ) : effectiveTab === 'receiving' ? (
              filteredReceivingItems.length === 0 ? (
                <EmptySlate label={isFiltering ? "No results" : "No receiving items assigned"} color={isFiltering ? "gray" : "teal"} />
              ) : (
                renderRows(
                  filteredReceivingItems.map((item) => (
                    <ReceivingAssignmentCard key={item.assignment_id} item={item} />
                  ))
                )
              )

            ) : filteredOrders.length === 0 ? (
              <>
                <EmptySlate label={isFiltering ? "No results" : "No current orders"} color={isFiltering ? "gray" : "green"} />
                {!isFiltering && filteredRepairs.length > 0 && (
                  <div className="mt-3">
                    <SectionHeader label="Repair Service" />
                    {renderRows(
                      filteredRepairs.map((repair) => (
                        <RepairCard
                          key={`orders-repair-${repair.repairId}`}
                          repair={repair}
                          techId={techId}
                          isExpanded={expandedItemKey === `repair-${repair.repairId}`}
                          onToggleExpand={() => toggleExpandedItem(`repair-${repair.repairId}`)}
                        />
                      ))
                    )}
                  </div>
                )}
              </>

            ) : (
              renderRows(
                filteredOrders.map((order) => (
                  renderOrderCard(order)
                ))
              )
            )}
        </div>

        {shouldShowStockSection && (
          <div className="mt-3">
            <SectionHeader label="Out Of Stock" />
            {renderRows(
              filteredStockOrders.map((order) => (
                renderOrderCard(order, `stock-${order.id}`, 'stock')
              ))
            )}
          </div>
        )}

        {/* ── Filter bar ── */}
        {tabCounts[effectiveTab] > 0 && (() => {
          const filterBar = (
            <div className="md:hidden bg-white/90 backdrop-blur-sm border-t border-gray-100 px-1 py-1.5">
              <UpNextFilterBar
                searchText={searchText}
                onSearchChange={setSearchText}
                quickFilter={quickFilter}
                onQuickFilterChange={setQuickFilter}
                quickFilterItems={QUICK_FILTER_ITEMS[effectiveTab]}
                quickFilterVariant={QUICK_FILTER_ITEMS[effectiveTab].some((i) => i.tone) ? 'fba' : 'slate'}
                placeholder={`Search ${visibleTabs.find((t) => t.id === effectiveTab)?.label ?? ''}...`}
              />
            </div>
          );
          if (filterBarPortalRef?.current) return createPortal(filterBar, filterBarPortalRef.current);
          return <div className="sticky bottom-0 left-0 right-0 z-10">{filterBar}</div>;
        })()}

    </div>
  );
}

function EmptySlate({ label, color = 'gray' }: { label: string; color?: 'gray' | 'green' | 'purple' | 'teal' | 'red' }) {
  const bg   = color === 'green' ? 'bg-emerald-50 border-emerald-100' : color === 'purple' ? 'bg-purple-50 border-purple-100' : color === 'teal' ? 'bg-teal-50 border-teal-100' : color === 'red' ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-200';
  const text = color === 'green' ? 'text-emerald-500' : color === 'purple' ? 'text-purple-500' : color === 'teal' ? 'text-teal-500' : color === 'red' ? 'text-red-500' : 'text-gray-500';
  const icon = color === 'green' ? 'text-emerald-300' : color === 'purple' ? 'text-purple-200' : color === 'teal' ? 'text-teal-200' : color === 'red' ? 'text-red-200' : 'text-gray-500';
  return (
    <motion.div
      {...framerPresence.upNextRow}
      transition={framerTransition.upNextRowMount}
      className={`rounded-2xl px-4 py-3 border ${bg}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={`text-xs font-bold uppercase tracking-widest ${text}`}>{label}</p>
        <Package className={`w-5 h-5 flex-shrink-0 ${icon}`} />
      </div>
    </motion.div>
  );
}

function SectionHeader({ label, color = 'orange' }: { label: string; color?: 'orange' | 'purple' | 'red' }) {
  const lineClass = color === 'purple' ? 'bg-purple-200' : color === 'red' ? 'bg-red-200' : 'bg-orange-200';
  const textClass = color === 'purple' ? 'text-purple-600' : color === 'red' ? 'text-red-600' : 'text-orange-600';
  return (
    <div className="flex items-center gap-2 px-1 py-1.5 mb-1">
      <div className={`h-px flex-1 ${lineClass}`} />
      <span className={`text-[9px] font-black uppercase tracking-widest ${textClass}`}>
        {label}
      </span>
      <div className={`h-px flex-1 ${lineClass}`} />
    </div>
  );
}
