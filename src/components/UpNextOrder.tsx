'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Check, Package } from './Icons';
import { TabSwitch } from './ui/TabSwitch';
import { useUpNextData } from '@/hooks/useUpNextData';
import { OrderCard } from './station/upnext/OrderCard';
import { RepairCard } from './station/upnext/RepairCard';
import { FbaItemCard } from './station/upnext/FbaItemCard';
import { ReceivingAssignmentCard } from './station/upnext/ReceivingAssignmentCard';

type TabId = 'orders' | 'returns' | 'repair' | 'fba' | 'test' | 'stock' | 'receiving';

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


export default function UpNextOrder({ techId, onStart, onMissingParts, onAllCompleted }: UpNextOrderProps) {
  const [activeTab, setActiveTab] = useState<TabId>('orders');
  const [showMissingPartsInput, setShowMissingPartsInput] = useState<number | null>(null);
  const [missingPartsReason, setMissingPartsReason] = useState('');
  const hasCelebratedRef = useRef(false);

  const { allOrders, allRepairs, fbaItems, receivingItems, loading, allCompletedToday, fetchOrders } =
    useUpNextData({ techId, onAllCompleted });


  const stockOrders   = allOrders.filter(isOutOfStock);
  const nonStockOrders = allOrders.filter((o) => !isOutOfStock(o));

  const tabCounts = {
    ...nonStockOrders.reduce(
      (acc, order) => { acc[getOrderBucket(order)] += 1; return acc; },
      { orders: 0, returns: 0, repair: 0, fba: 0, test: 0, stock: 0, receiving: 0 } as Record<TabId, number>
    ),
    stock:     stockOrders.length,
    repair:    allRepairs.length,
    fba:       fbaItems.filter((i) => i.status !== 'SHIPPED').length,
    receiving: receivingItems.length,
  };

  const visibleTabs: Array<{ id: TabId; label: string; color: 'green' | 'yellow' | 'orange' | 'purple' | 'gray' | 'red' | 'teal' }> = [
    { id: 'orders',    label: 'Orders',    color: 'green' },
    ...(tabCounts.returns   > 0 ? [{ id: 'returns'   as const, label: 'Returns',   color: 'yellow' as const }] : []),
    ...(tabCounts.fba       > 0 ? [{ id: 'fba'       as const, label: 'FBA',       color: 'purple' as const }] : []),
    ...(tabCounts.repair    > 0 ? [{ id: 'repair'    as const, label: 'Repair',    color: 'orange' as const }] : []),
    ...(tabCounts.test      > 0 ? [{ id: 'test'      as const, label: 'Test',      color: 'gray'   as const }] : []),
    ...(tabCounts.stock     > 0 ? [{ id: 'stock'     as const, label: 'Stock',     color: 'red'    as const }] : []),
    ...(tabCounts.receiving > 0 ? [{ id: 'receiving' as const, label: 'Receiving', color: 'teal'   as const }] : []),
  ];

  const activeTabVisible = visibleTabs.some((tab) => tab.id === activeTab);
  const effectiveTab     = activeTabVisible ? activeTab : visibleTabs[0]?.id || 'orders';
  const orders           = nonStockOrders.filter((order) => getOrderBucket(order) === effectiveTab);
  const preferred: TabId[] = ['orders', 'returns', 'fba', 'repair', 'test', 'stock', 'receiving'];
  const shouldShowStockSection = stockOrders.length > 0 && effectiveTab !== 'stock';

  useEffect(() => {
    if (!activeTabVisible && effectiveTab !== activeTab) setActiveTab(effectiveTab);
  }, [activeTabVisible, effectiveTab, activeTab]);

  useEffect(() => {
    // Only auto-switch if the current tab is empty. For non-order tabs (repair/fba/receiving)
    // we use tabCounts directly; for order-bucket tabs we fall through the same path.
    if (tabCounts[effectiveTab] > 0) return;
    const next = preferred.find((id) => tabCounts[id] > 0);
    if (next && next !== activeTab) setActiveTab(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTab, activeTab, tabCounts.orders, tabCounts.returns, tabCounts.repair, tabCounts.fba, tabCounts.test, tabCounts.stock, tabCounts.receiving]);

  useEffect(() => {
    if (effectiveTab === 'orders' && allCompletedToday && !hasCelebratedRef.current) {
      confetti({ particleCount: 180, spread: 80, origin: { y: 0.7 } });
      hasCelebratedRef.current = true;
      return;
    }
    if (!allCompletedToday) hasCelebratedRef.current = false;
  }, [allCompletedToday, effectiveTab]);

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
        />

        {/* ── Primary tab content ── */}
        {effectiveTab === 'stock' ? (
          stockOrders.length === 0 ? (
            <EmptySlate label="No out-of-stock orders" color="red" />
          ) : (
            <div className="flex flex-col">
              <AnimatePresence mode="popLayout">
                {stockOrders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    effectiveTab="stock"
                    techId={techId}
                    showMissingPartsInput={showMissingPartsInput}
                    missingPartsReason={missingPartsReason}
                    onStart={handleStart}
                    onMissingPartsToggle={(id) => setShowMissingPartsInput(showMissingPartsInput === id ? null : id)}
                    onMissingPartsReasonChange={setMissingPartsReason}
                    onMissingPartsSubmit={handleMissingParts}
                    onMissingPartsCancel={() => setShowMissingPartsInput(null)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )

        ) : allCompletedToday && effectiveTab === 'orders' ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-emerald-50 rounded-2xl p-5 border-2 border-emerald-200 text-center space-y-3"
          >
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-2">
              <Check className="w-8 h-8 text-emerald-600" />
            </div>
            <h3 className="text-sm font-black text-emerald-900 uppercase tracking-widest leading-tight">
              All orders have been completed today!
            </h3>
            <p className="text-[10px] font-bold text-emerald-600/70 uppercase tracking-widest">Great job!</p>
          </motion.div>

        ) : effectiveTab === 'repair' ? (
          allRepairs.length === 0 ? (
            <EmptySlate label="No repairs in queue" />
          ) : (
            <div className="flex flex-col">
              {/* Unassigned notice */}
              {allRepairs.some((r) => r.assignedTechId === null) && (
                <div className="flex items-center gap-2 px-1 py-1.5 mb-1">
                  <div className="h-px flex-1 bg-red-100" />
                  <span className="text-[9px] font-black uppercase tracking-widest text-red-400">
                    {allRepairs.filter((r) => r.assignedTechId === null).length} unassigned
                  </span>
                  <div className="h-px flex-1 bg-red-100" />
                </div>
              )}
              <AnimatePresence mode="popLayout">
                {allRepairs.map((repair) => <RepairCard key={repair.repairId} repair={repair} />)}
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
          <EmptySlate label="No current orders" />

        ) : (
          <div className="flex flex-col">
            <AnimatePresence mode="popLayout">
              {orders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  effectiveTab={effectiveTab}
                  techId={techId}
                  showMissingPartsInput={showMissingPartsInput}
                  missingPartsReason={missingPartsReason}
                  onStart={handleStart}
                  onMissingPartsToggle={(id) => setShowMissingPartsInput(showMissingPartsInput === id ? null : id)}
                  onMissingPartsReasonChange={setMissingPartsReason}
                  onMissingPartsSubmit={handleMissingParts}
                  onMissingPartsCancel={() => setShowMissingPartsInput(null)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}

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
                  <OrderCard
                    key={`stock-${order.id}`}
                    order={order}
                    effectiveTab="stock"
                    techId={techId}
                    showMissingPartsInput={showMissingPartsInput}
                    missingPartsReason={missingPartsReason}
                    onStart={handleStart}
                    onMissingPartsToggle={(id) => setShowMissingPartsInput(showMissingPartsInput === id ? null : id)}
                    onMissingPartsReasonChange={setMissingPartsReason}
                    onMissingPartsSubmit={handleMissingParts}
                    onMissingPartsCancel={() => setShowMissingPartsInput(null)}
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}

    </div>
  );
}

function EmptySlate({ label, color = 'gray' }: { label: string; color?: 'gray' | 'purple' | 'teal' | 'red' }) {
  const bg   = color === 'purple' ? 'bg-purple-50 border-purple-100' : color === 'teal' ? 'bg-teal-50 border-teal-100' : color === 'red' ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-200';
  const text = color === 'purple' ? 'text-purple-400' : color === 'teal' ? 'text-teal-400' : color === 'red' ? 'text-red-400' : 'text-gray-400';
  const icon = color === 'purple' ? 'text-purple-200' : color === 'teal' ? 'text-teal-200' : color === 'red' ? 'text-red-200' : 'text-gray-300';
  return (
    <div className={`rounded-2xl px-4 py-3 border ${bg}`}>
      <div className="flex items-center justify-between gap-3">
        <p className={`text-xs font-bold uppercase tracking-widest ${text}`}>{label}</p>
        <Package className={`w-5 h-5 flex-shrink-0 ${icon}`} />
      </div>
    </div>
  );
}
