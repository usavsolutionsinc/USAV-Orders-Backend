'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Check, Package } from './Icons';
import { TabSwitch } from './ui/TabSwitch';
import { useUpNextData } from '@/hooks/useUpNextData';
import { OrderCard } from './station/upnext/OrderCard';
import { RepairCard } from './station/upnext/RepairCard';
import { FbaItemCard } from './station/upnext/FbaItemCard';
import { ReceivingAssignmentCard } from './station/upnext/ReceivingAssignmentCard';

type TabId = 'all' | 'orders' | 'returns' | 'repair' | 'fba' | 'test' | 'stock' | 'receiving';

interface UpNextOrderProps {
  techId: string;
  onStart: (tracking: string) => void;
  onMissingParts: (orderId: number, reason: string) => void;
  onAllCompleted?: () => void;
}

function isOutOfStock(order: { out_of_stock: string | null }): boolean {
  return !!String(order.out_of_stock || '').trim();
}

function getOrderBucket(order: { order_id: string; account_source: string | null; status: string; sku: string; out_of_stock: string | null }): TabId {
  const orderId       = String(order.order_id || '').toLowerCase();
  const accountSource = String(order.account_source || '').toLowerCase();
  const status        = String(order.status || '').toLowerCase();
  const sku           = String(order.sku || '').toLowerCase();
  const haystack      = `${orderId} ${accountSource} ${status} ${sku}`;
  if (/\b(return|returns|rma)\b/.test(haystack)) return 'returns';
  if (/\b(test|testing|qa|sample)\b/.test(haystack)) return 'test';
  return 'orders';
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

function getDateSortValue(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

type CombinedCardItem =
  | { type: 'order'; key: string; sortValue: number; order: any; effectiveTab: 'orders' | 'returns' | 'test' | 'stock' }
  | { type: 'repair'; key: string; sortValue: number; repair: any }
  | { type: 'fba'; key: string; sortValue: number; item: any }
  | { type: 'receiving'; key: string; sortValue: number; item: any };


const TAB_ORDER: TabId[] = ['all', 'orders', 'returns', 'fba', 'repair', 'test', 'stock', 'receiving'];

export default function UpNextOrder({ techId, onStart, onMissingParts, onAllCompleted }: UpNextOrderProps) {
  const [activeTab, setActiveTab] = useState<TabId>('all');
  const [prevTabIndex, setPrevTabIndex] = useState(0);
  const [expandedItemKey, setExpandedItemKey] = useState<string | null>(null);
  const prefersReducedMotion = useReducedMotion();
  const [showMissingPartsInput, setShowMissingPartsInput] = useState<number | null>(null);
  const [missingPartsReason, setMissingPartsReason] = useState('');
  const hasCelebratedRef = useRef(false);

  const { allOrders, allRepairs, fbaItems, receivingItems, loading, allCompletedToday, fetchOrders } =
    useUpNextData({ techId, onAllCompleted });


  const stockOrders   = allOrders.filter(isOutOfStock);
  // Exclude orders already processed by a tech scan (shipment_id matched in tech_serial_numbers)
  const nonStockOrders = allOrders.filter((o) => !isOutOfStock(o) && !o.has_tech_scan);
  const sortedRepairs = [...allRepairs].sort(
    (a, b) => getRepairSortValue(a.deadlineAt, a.dateTime) - getRepairSortValue(b.deadlineAt, b.dateTime)
  );
  const activeFbaItems = fbaItems.filter((i) => i.status !== 'SHIPPED');

  const tabCounts = {
    ...nonStockOrders.reduce(
      (acc, order) => { acc[getOrderBucket(order)] += 1; return acc; },
      { all: 0, orders: 0, returns: 0, repair: 0, fba: 0, test: 0, stock: 0, receiving: 0 } as Record<TabId, number>
    ),
    stock:     stockOrders.length,
    repair:    sortedRepairs.length,
    fba:       activeFbaItems.length,
    receiving: receivingItems.length,
    all:       nonStockOrders.length + sortedRepairs.length + activeFbaItems.length + receivingItems.length,
  };

  const allItems: CombinedCardItem[] = [
    ...nonStockOrders.map((order) => ({
      type: 'order' as const,
      key: `order-${order.id}`,
      sortValue: getDateSortValue(order.ship_by_date || order.created_at),
      order,
      effectiveTab: getOrderBucket(order) as 'orders' | 'returns' | 'test',
    })),
    ...sortedRepairs.map((repair) => ({
      type: 'repair' as const,
      key: `repair-${repair.repairId}`,
      sortValue: getRepairSortValue(repair.deadlineAt, repair.dateTime),
      repair,
    })),
    ...activeFbaItems.map((item) => ({
      type: 'fba' as const,
      key: `fba-${item.item_id}`,
      sortValue: getDateSortValue(item.due_date),
      item,
    })),
    ...receivingItems.map((item) => ({
      type: 'receiving' as const,
      key: `receiving-${item.assignment_id}`,
      sortValue: getDateSortValue(item.assigned_at),
      item,
    })),
  ].sort((a, b) => a.sortValue - b.sortValue);

  const visibleTabs: Array<{ id: TabId; label: string; count?: number; color: 'green' | 'yellow' | 'orange' | 'purple' | 'gray' | 'red' | 'teal' }> = [
    { id: 'all',       label: 'All',       color: 'green',  count: tabCounts.all       || undefined },
    { id: 'orders',    label: 'Orders',    color: 'green',  count: tabCounts.orders    || undefined },
    ...(tabCounts.returns   > 0 ? [{ id: 'returns'   as const, label: 'Returns',   color: 'yellow' as const, count: tabCounts.returns   }] : []),
    ...(tabCounts.fba       > 0 ? [{ id: 'fba'       as const, label: 'FBA',       color: 'purple' as const, count: tabCounts.fba       }] : []),
    ...(tabCounts.repair    > 0 ? [{ id: 'repair'    as const, label: 'Repair',    color: 'orange' as const, count: tabCounts.repair    }] : []),
    ...(tabCounts.test      > 0 ? [{ id: 'test'      as const, label: 'Test',      color: 'gray'   as const, count: tabCounts.test      }] : []),
    ...(tabCounts.stock     > 0 ? [{ id: 'stock'     as const, label: 'Stock',     color: 'red'    as const, count: tabCounts.stock     }] : []),
    ...(tabCounts.receiving > 0 ? [{ id: 'receiving' as const, label: 'Receiving', color: 'teal'   as const, count: tabCounts.receiving }] : []),
  ];

  const activeTabVisible = visibleTabs.some((tab) => tab.id === activeTab);
  const effectiveTab     = activeTabVisible ? activeTab : visibleTabs[0]?.id || 'orders';
  const orders           = nonStockOrders.filter((order) => getOrderBucket(order) === effectiveTab);
  const preferred: TabId[] = ['all', 'orders', 'returns', 'fba', 'repair', 'test', 'stock', 'receiving'];

  // Urgency breakdown for the summary bar (orders tab only)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lateCount = nonStockOrders.filter((o) => {
    const d = o.ship_by_date ? new Date(o.ship_by_date) : null;
    return d && d < today;
  }).length;
  const dueTodayCount = nonStockOrders.filter((o) => {
    const d = o.ship_by_date ? new Date(o.ship_by_date) : null;
    if (!d) return false;
    d.setHours(0, 0, 0, 0);
    return d.getTime() === today.getTime();
  }).length;
  const openOrderCount = nonStockOrders.filter((o) => o.tester_id == null).length;

  const currentTabIndex = TAB_ORDER.indexOf(effectiveTab);
  const slideDirection  = currentTabIndex >= prevTabIndex ? 1 : -1;

  // True swipe: new panel enters from the leading edge, old exits to trailing edge.
  // "55%" gives a clear directional feel without over-travelling on small screens.
  const tabContentVariants = {
    enter: (dir: number) => ({
      x: prefersReducedMotion ? 0 : (dir > 0 ? '55%' : '-55%'),
      opacity: prefersReducedMotion ? 0 : 1,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: prefersReducedMotion ? 0 : (dir > 0 ? '-28%' : '28%'),
      opacity: 0,
    }),
  };
  const shouldShowStockSection = stockOrders.length > 0 && effectiveTab !== 'stock';

  useEffect(() => {
    if (!activeTabVisible && effectiveTab !== activeTab) setActiveTab(effectiveTab);
  }, [activeTabVisible, effectiveTab, activeTab]);

  useEffect(() => {
    setPrevTabIndex(TAB_ORDER.indexOf(effectiveTab));
  }, [effectiveTab]);

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
    const next = preferred.find((id) => tabCounts[id] > 0);
    if (next && next !== activeTab) setActiveTab(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTab, activeTab, tabCounts.orders, tabCounts.returns, tabCounts.repair, tabCounts.fba, tabCounts.test, tabCounts.stock, tabCounts.receiving]);

  useEffect(() => {
    if (effectiveTab === 'orders' && allCompletedToday && stockOrders.length === 0 && !hasCelebratedRef.current) {
      confetti({ particleCount: 180, spread: 80, origin: { y: 0.7 } });
      hasCelebratedRef.current = true;
      return;
    }
    if (!allCompletedToday || stockOrders.length > 0) hasCelebratedRef.current = false;
  }, [allCompletedToday, effectiveTab, stockOrders.length]);

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

  const renderOrderCard = (order: any, key?: string, effectiveOrderTab?: 'orders' | 'returns' | 'test' | 'stock') => (
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

  if (loading) {
    return (
      <div className="bg-gray-50 rounded-2xl p-3 border border-gray-200 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-20 mb-3" />
        <div className="h-20 bg-gray-200 rounded" />
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-1.5">
        <TabSwitch
          tabs={visibleTabs}
          activeTab={effectiveTab}
          onTabChange={(tab) => setActiveTab(tab as TabId)}
          scrollable
        />

        {/* ── Urgency summary bar ── */}
        <AnimatePresence initial={false}>
          {tabCounts.all > 0 && (lateCount > 0 || dueTodayCount > 0 || openOrderCount > 0) && (
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
                {openOrderCount > 0 && (lateCount > 0 || dueTodayCount > 0) && (
                  <span className="text-gray-200 text-[9px]">·</span>
                )}
                {openOrderCount > 0 && (
                  <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-amber-600">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
                    {openOrderCount} open
                  </span>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Primary tab content ── */}
        <div className="relative overflow-hidden">
        <AnimatePresence mode="wait" initial={false} custom={slideDirection}>
          <motion.div
            key={effectiveTab}
            custom={slideDirection}
            variants={tabContentVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              x: { type: 'spring', stiffness: 340, damping: 32, mass: 0.9 },
              opacity: { duration: 0.16, ease: 'easeOut' },
            }}
          >
            {effectiveTab === 'stock' ? (
              stockOrders.length === 0 ? (
                <EmptySlate label="No out-of-stock orders" color="red" />
              ) : (
                <div className="flex flex-col">
                  <AnimatePresence mode="popLayout">
                    {stockOrders.map((order) => (
                      renderOrderCard(order, `stock-${order.id}`, 'stock')
                    ))}
                  </AnimatePresence>
                </div>
              )

            ) : effectiveTab === 'all' ? (
              allItems.length === 0 ? (
                <EmptySlate label="No current work" color="green" />
              ) : (
                <div className="flex flex-col">
                  <AnimatePresence mode="popLayout">
                    {allItems.map((item) => {
                      if (item.type === 'order') {
                        return renderOrderCard(item.order, item.key, item.effectiveTab);
                      }
                      if (item.type === 'repair') {
                        return (
                          <RepairCard
                            key={item.key}
                            repair={item.repair}
                            techId={techId}
                            isExpanded={expandedItemKey === item.key}
                            onToggleExpand={() => toggleExpandedItem(item.key)}
                          />
                        );
                      }
                      if (item.type === 'fba') return <FbaItemCard key={item.key} item={item.item} />;
                      return <ReceivingAssignmentCard key={item.key} item={item.item} />;
                    })}
                  </AnimatePresence>
                </div>
              )

            ) : allCompletedToday && effectiveTab === 'orders' && stockOrders.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="bg-emerald-50 rounded-2xl p-5 border-2 border-emerald-200 text-center space-y-3"
              >
                <motion.div
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.12, type: 'spring', stiffness: 340, damping: 22 }}
                  className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-2"
                >
                  <Check className="w-8 h-8 text-emerald-600" />
                </motion.div>
                <motion.h3
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="text-sm font-black text-emerald-900 uppercase tracking-widest leading-tight"
                >
                  All orders have been completed today!
                </motion.h3>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.32, duration: 0.25 }}
                  className="text-[10px] font-bold text-emerald-600/70 uppercase tracking-widest"
                >
                  Great job!
                </motion.p>
              </motion.div>

            ) : effectiveTab === 'repair' ? (
              sortedRepairs.length === 0 ? (
                <EmptySlate label="No repairs in queue" />
              ) : (
                <div className="flex flex-col">
                  {sortedRepairs.some((r) => r.assignedTechId === null) && (
                    <div className="flex items-center gap-2 px-1 py-1.5 mb-1">
                      <div className="h-px flex-1 bg-red-100" />
                      <span className="text-[9px] font-black uppercase tracking-widest text-red-400">
                        {sortedRepairs.filter((r) => r.assignedTechId === null).length} unassigned
                      </span>
                      <div className="h-px flex-1 bg-red-100" />
                    </div>
                  )}
                  <AnimatePresence mode="popLayout">
                    {sortedRepairs.map((repair) => (
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
              fbaItems.filter((i) => i.status !== 'SHIPPED').length === 0 ? (
                <EmptySlate label="No active FBA items" color="purple" />
              ) : (
                <div className="flex flex-col">
                  <AnimatePresence mode="popLayout">
                    {fbaItems.filter((i) => i.status !== 'SHIPPED').map((item) => (
                      <FbaItemCard key={item.item_id} item={item} />
                    ))}
                  </AnimatePresence>
                </div>
              )

            ) : effectiveTab === 'receiving' ? (
              receivingItems.length === 0 ? (
                <EmptySlate label="No receiving items assigned" color="teal" />
              ) : (
                <div className="flex flex-col">
                  <AnimatePresence mode="popLayout">
                    {receivingItems.map((item) => (
                      <ReceivingAssignmentCard key={item.assignment_id} item={item} />
                    ))}
                  </AnimatePresence>
                </div>
              )

            ) : orders.length === 0 ? (
              <EmptySlate label="No current orders" color="green" />

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
                {stockOrders.map((order) => (
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
