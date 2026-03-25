'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Package } from './Icons';
import { TabSwitch } from './ui/TabSwitch';
import { useUpNextData } from '@/hooks/useUpNextData';
import { OrderCard } from './station/upnext/OrderCard';
import { RepairCard } from './station/upnext/RepairCard';
import { FbaItemCard } from './station/upnext/FbaItemCard';
import { ReceivingAssignmentCard } from './station/upnext/ReceivingAssignmentCard';

type TabId = 'all' | 'orders' | 'repair' | 'fba' | 'stock' | 'receiving';

interface UpNextOrderProps {
  techId: string;
  onStart: (tracking: string) => void;
  onMissingParts: (orderId: number, reason: string) => void;
  onAllCompleted?: () => void;
}

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

export default function UpNextOrder({ techId, onStart, onMissingParts, onAllCompleted }: UpNextOrderProps) {
  const [activeTab, setActiveTab] = useState<TabId>('all');
  /** +1 = animate like swiping to a tab to the right, -1 = to the left (visible tab bar order). */
  const [tabSlideDir, setTabSlideDir] = useState(1);
  const [expandedItemKey, setExpandedItemKey] = useState<string | null>(null);
  const prefersReducedMotion = useReducedMotion();
  const [showMissingPartsInput, setShowMissingPartsInput] = useState<number | null>(null);
  const [missingPartsReason, setMissingPartsReason] = useState('');
  const hasCelebratedRef = useRef(false);

  const { allOrders, allRepairs, fbaItems, receivingItems, loading, allCompletedToday, fetchOrders } =
    useUpNextData({ techId, onAllCompleted });

  const pendingVisibleOrders = allOrders.filter((order) => !order.has_tech_scan);

  // Hide orders already completed at the testing station. `has_tech_scan` comes
  // from a shipment_id match in tech_serial_numbers.
  const stockOrders = pendingVisibleOrders.filter(isOutOfStock);
  // Match the pending orders source data and only split out stock blockers here.
  const nonStockOrders = pendingVisibleOrders.filter((order) => !isOutOfStock(order));
  const sortedRepairs = [...allRepairs].sort(
    (a, b) => getRepairSortValue(a.deadlineAt, a.dateTime) - getRepairSortValue(b.deadlineAt, b.dateTime)
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
  const filteredOrders = nonStockOrders;
  const filteredStockOrders = stockOrders;
  const filteredRepairs = sortedRepairs;
  const filteredFbaItems = activeFbaItems;
  const filteredReceivingItems = receivingItems;
  const tabCounts = rawTabCounts;

  type VisibleTab = { id: TabId; label: string; count?: number; color: 'green' | 'yellow' | 'orange' | 'purple' | 'gray' | 'red' | 'teal' };
  const visibleTabs: VisibleTab[] = useMemo(
    () => [
      { id: 'all', label: 'All', color: 'green', count: rawTabCounts.all || undefined },
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
    [
      rawTabCounts.all,
      rawTabCounts.orders,
      rawTabCounts.fba,
      rawTabCounts.repair,
      rawTabCounts.stock,
      rawTabCounts.receiving,
    ],
  );

  const activeTabVisible = visibleTabs.some((tab) => tab.id === activeTab);
  const effectiveTab     = activeTabVisible ? activeTab : visibleTabs[0]?.id || 'orders';
  const orders = nonStockOrders;
  const visibleTabBarIndex = useCallback(
    (id: TabId) => {
      const v = visibleTabs.findIndex((t) => t.id === id);
      if (v >= 0) return v;
      const o = TAB_ORDER.indexOf(id);
      return o >= 0 ? o : 0;
    },
    [visibleTabs],
  );

  // Urgency breakdown for the summary bar (orders tab only)
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
  // Full-width horizontal pager (mobile-style): both panels move on X; no vertical slide.
  const tabContentVariants = {
    enter: (dir: number) => ({
      x: prefersReducedMotion ? 0 : dir > 0 ? '100%' : '-100%',
      opacity: prefersReducedMotion ? 1 : 0,
    }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({
      x: prefersReducedMotion ? 0 : dir > 0 ? '-100%' : '100%',
      opacity: prefersReducedMotion ? 1 : 0,
    }),
  };

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
  }, [effectiveTab]);

  useEffect(() => {
    // Only auto-switch if the current tab is empty. For non-order tabs (repair/fba/receiving)
    // we use tabCounts directly; for order-bucket tabs we fall through the same path.
    if (effectiveTab === 'all' || effectiveTab === 'orders') return;
    if (tabCounts[effectiveTab] > 0) return;
    const next = TAB_ORDER.find((id) => tabCounts[id] > 0);
    if (next && next !== activeTab) selectTab(next, effectiveTab);
  }, [
    effectiveTab,
    activeTab,
    tabCounts.orders,
    tabCounts.repair,
    tabCounts.fba,
    tabCounts.stock,
    tabCounts.receiving,
    selectTab,
  ]);

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
    setExpandedItemKey((current) => current === key ? null : key);
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

  const allSections = [
    {
      id: 'orders',
      label: 'Orders',
      headerColor: 'orange' as const,
      count: filteredOrders.length,
      render: () => (
        <AnimatePresence mode="popLayout">
          {filteredOrders.map((order) => renderOrderCard(order))}
        </AnimatePresence>
      ),
    },
    {
      id: 'fba',
      label: 'FBA Planned Items',
      headerColor: 'purple' as const,
      count: filteredFbaItems.length,
      render: () => (
        <AnimatePresence mode="popLayout">
          {filteredFbaItems.map((item) => (
            <FbaItemCard
              key={item.item_id}
              item={item}
              isExpanded={expandedItemKey === `fba-${item.item_id}`}
              onToggleExpand={() => toggleExpandedItem(`fba-${item.item_id}`)}
            />
          ))}
        </AnimatePresence>
      ),
    },
    {
      id: 'repair',
      label: 'Repair Service',
      headerColor: 'orange' as const,
      count: filteredRepairs.length,
      render: () => (
        <AnimatePresence mode="popLayout">
          {filteredRepairs.map((repair) => (
            <RepairCard
              key={`repair-${repair.repairId}`}
              repair={repair}
              techId={techId}
              isExpanded={expandedItemKey === `repair-${repair.repairId}`}
              onToggleExpand={() => toggleExpandedItem(`repair-${repair.repairId}`)}
            />
          ))}
        </AnimatePresence>
      ),
    },
    {
      id: 'receiving',
      label: 'Receiving',
      headerColor: 'orange' as const,
      count: filteredReceivingItems.length,
      render: () => (
        <AnimatePresence mode="popLayout">
          {filteredReceivingItems.map((item) => (
            <ReceivingAssignmentCard key={item.assignment_id} item={item} />
          ))}
        </AnimatePresence>
      ),
    },
  ].filter((section) => section.count > 0);

  if (loading) {
    return (
      <div className="bg-gray-50 rounded-2xl p-3 border border-gray-200 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-20 mb-3" />
        <div className="h-20 bg-gray-200 rounded" />
      </div>
    );
  }

  return (
    <div className="relative flex flex-col space-y-1.5">
        <TabSwitch
          tabs={visibleTabs}
          activeTab={effectiveTab}
          onTabChange={(tab) => selectTab(tab as TabId)}
          scrollable
        />

        {/* ── Urgency summary bar ── */}
        <AnimatePresence initial={false}>
          {tabCounts.all > 0 && (lateCount > 0 || dueTodayCount > 0) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
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
                  <span className="text-gray-200 text-[9px]">·</span>
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

        {/* ── Primary tab content ── */}
        {/* Grid stacks entering + exiting panes in one cell so sync horizontal swipe does not double layout height */}
        <div className="grid overflow-x-hidden">
        <AnimatePresence mode="sync" initial={false} custom={tabSlideDir}>
          <motion.div
            key={effectiveTab}
            custom={tabSlideDir}
            variants={tabContentVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              x: { type: 'tween', duration: prefersReducedMotion ? 0.01 : 0.32, ease: [0.32, 0.72, 0, 1] },
              opacity: { duration: prefersReducedMotion ? 0.01 : 0.2, ease: 'easeOut' },
            }}
            className="col-start-1 row-start-1 min-w-0 w-full"
          >
            {effectiveTab === 'stock' ? (
              filteredStockOrders.length === 0 ? (
                <EmptySlate label="No out-of-stock orders" color="red" />
              ) : (
                <div className="flex flex-col">
                  <AnimatePresence mode="popLayout">
                    {filteredStockOrders.map((order) => (
                      renderOrderCard(order, `stock-${order.id}`, 'stock')
                    ))}
                  </AnimatePresence>
                </div>
              )

            ) : effectiveTab === 'all' ? (
              allSections.length === 0 ? (
                showNoCurrentOrdersBanner ? (
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
                      <div className="flex flex-col">
                        {section.render()}
                      </div>
                    </div>
                  ))}
                </div>
              )

            ) : effectiveTab === 'repair' ? (
              filteredRepairs.length === 0 ? (
                <EmptySlate label="No repairs in queue" />
              ) : (
                <div className="flex flex-col">
                  {filteredRepairs.some((r) => r.assignedTechId === null) && (
                    <div className="flex items-center gap-2 px-1 py-1.5 mb-1">
                      <div className="h-px flex-1 bg-red-100" />
                      <span className="text-[9px] font-black uppercase tracking-widest text-red-400">
                        {filteredRepairs.filter((r) => r.assignedTechId === null).length} unassigned
                      </span>
                      <div className="h-px flex-1 bg-red-100" />
                    </div>
                  )}
                  <AnimatePresence mode="popLayout">
                    {filteredRepairs.map((repair) => (
                      <RepairCard
                        key={repair.repairId}
                        repair={repair}
                        techId={techId}
                        isExpanded={expandedItemKey === `repair-${repair.repairId}`}
                        onToggleExpand={() => toggleExpandedItem(`repair-${repair.repairId}`)}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )

            ) : effectiveTab === 'fba' ? (
              filteredFbaItems.length === 0 ? (
                <EmptySlate label="No active FBA items" color="purple" />
              ) : (
                <div className="flex flex-col">
                  <AnimatePresence mode="popLayout">
                    {filteredFbaItems.map((item) => (
                      <FbaItemCard
                        key={item.item_id}
                        item={item}
                        isExpanded={expandedItemKey === `fba-${item.item_id}`}
                        onToggleExpand={() => toggleExpandedItem(`fba-${item.item_id}`)}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )

            ) : effectiveTab === 'receiving' ? (
              filteredReceivingItems.length === 0 ? (
                <EmptySlate label="No receiving items assigned" color="teal" />
              ) : (
                <div className="flex flex-col">
                  <AnimatePresence mode="popLayout">
                    {filteredReceivingItems.map((item) => (
                      <ReceivingAssignmentCard key={item.assignment_id} item={item} />
                    ))}
                  </AnimatePresence>
                </div>
              )

            ) : orders.length === 0 ? (
              <div className="flex flex-col">
                <EmptySlate label="No current orders" color="green" />
                {filteredRepairs.length > 0 && (
                  <div className="mt-3">
                    <SectionHeader label="Repair Service" />
                    <div className="flex flex-col">
                      <AnimatePresence mode="popLayout">
                        {filteredRepairs.map((repair) => (
                          <RepairCard
                            key={`orders-repair-${repair.repairId}`}
                            repair={repair}
                            techId={techId}
                            isExpanded={expandedItemKey === `repair-${repair.repairId}`}
                            onToggleExpand={() => toggleExpandedItem(`repair-${repair.repairId}`)}
                          />
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                )}
              </div>

            ) : (
              <div className="flex flex-col">
                <AnimatePresence mode="popLayout">
                  {orders.map((order) => (
                    renderOrderCard(order)
                  ))}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        </div>

        {shouldShowStockSection && (
          <div className="mt-3">
            <div className="flex items-center gap-2 px-1 py-1.5 mb-1">
              <div className="h-px flex-1 bg-orange-200" />
              <span className="text-[9px] font-black uppercase tracking-widest text-orange-600">
                Out Of Stock
              </span>
              <div className="h-px flex-1 bg-orange-200" />
            </div>
            <div className="flex flex-col">
              <AnimatePresence mode="popLayout">
                {filteredStockOrders.map((order) => (
                  renderOrderCard(order, `stock-${order.id}`, 'stock')
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}

    </div>
  );
}

function EmptySlate({ label, color = 'gray' }: { label: string; color?: 'gray' | 'green' | 'purple' | 'teal' | 'red' }) {
  const bg   = color === 'green' ? 'bg-emerald-50 border-emerald-100' : color === 'purple' ? 'bg-purple-50 border-purple-100' : color === 'teal' ? 'bg-teal-50 border-teal-100' : color === 'red' ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-200';
  const text = color === 'green' ? 'text-emerald-500' : color === 'purple' ? 'text-purple-400' : color === 'teal' ? 'text-teal-400' : color === 'red' ? 'text-red-400' : 'text-gray-400';
  const icon = color === 'green' ? 'text-emerald-300' : color === 'purple' ? 'text-purple-200' : color === 'teal' ? 'text-teal-200' : color === 'red' ? 'text-red-200' : 'text-gray-300';
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-2xl px-4 py-3 border ${bg}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={`text-xs font-bold uppercase tracking-widest ${text}`}>{label}</p>
        <Package className={`w-5 h-5 flex-shrink-0 ${icon}`} />
      </div>
    </motion.div>
  );
}

function SectionHeader({ label, color = 'orange' }: { label: string; color?: 'orange' | 'purple' }) {
  const lineClass = color === 'purple' ? 'bg-purple-200' : 'bg-orange-200';
  const textClass = color === 'purple' ? 'text-purple-600' : 'text-orange-600';
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
