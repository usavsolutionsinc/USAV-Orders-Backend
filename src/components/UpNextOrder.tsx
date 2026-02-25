'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Play, Package, Calendar, X, Check, ExternalLink } from './Icons';
import { TabSwitch } from './ui/TabSwitch';
import { ShipByDate } from './ui/ShipByDate';
import { OutOfStockField } from './ui/OutOfStockField';
import { useExternalItemUrl } from '@/hooks/useExternalItemUrl';
import { PlatformExternalChip } from './ui/PlatformExternalChip';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/lib/timezone';

interface Order {
  id: number;
  ship_by_date: string | null;
  created_at: string | null;
  order_id: string;
  product_title: string;
  item_number: string | null;
  account_source: string | null;
  sku: string;
  condition?: string | null;
  quantity?: string | null;
  status: string;
  shipping_tracking_number: string;
  out_of_stock: string | null;
  is_shipped: boolean;
}

interface UpNextOrderProps {
  techId: string;
  onStart: (tracking: string) => void;
  onMissingParts: (orderId: number, reason: string) => void;
  onAllCompleted?: () => void;
}

export default function UpNextOrder({ techId, onStart, onMissingParts, onAllCompleted }: UpNextOrderProps) {
  const [activeTab, setActiveTab] = useState<'current' | 'stock'>('current');
  const [orders, setOrders] = useState<Order[]>([]);
  const [globalOutOfStockOrders, setGlobalOutOfStockOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [allCompletedToday, setAllCompletedToday] = useState(false);
  const [showMissingPartsInput, setShowMissingPartsInput] = useState<number | null>(null);
  const [missingPartsReason, setMissingPartsReason] = useState('');
  const { getExternalUrlByItemNumber, openExternalByItemNumber } = useExternalItemUrl();
  const hasCelebratedRef = useRef(false);

  const getOrderIdLast4 = (orderId: string) => {
    const digits = String(orderId || '').replace(/\D/g, '');
    if (digits.length >= 4) return digits.slice(-4);
    return String(orderId || '').slice(-4);
  };

  const getDisplayShipByDate = (order: Order) => {
    const shipByRaw = String(order.ship_by_date || '').trim();
    const createdAtRaw = String(order.created_at || '').trim();

    const isInvalidShipBy =
      !shipByRaw ||
      /^\d+$/.test(shipByRaw) ||
      Number.isNaN(new Date(shipByRaw).getTime());

    if (isInvalidShipBy) return createdAtRaw || null;
    return shipByRaw;
  };

  const getDaysLateNumber = (shipByDate: string | null | undefined, fallbackDate?: string | null | undefined) => {
    const shipByKey = toPSTDateKey(shipByDate) || toPSTDateKey(fallbackDate);
    const todayKey = getCurrentPSTDateKey();
    if (!shipByKey || !todayKey) return 0;
    const [sy, sm, sd] = shipByKey.split('-').map(Number);
    const [ty, tm, td] = todayKey.split('-').map(Number);
    const shipByIndex = Math.floor(Date.UTC(sy, sm - 1, sd) / 86400000);
    const todayIndex = Math.floor(Date.UTC(ty, tm - 1, td) / 86400000);
    return Math.max(0, todayIndex - shipByIndex);
  };
  const getDaysLateTone = (daysLate: number) => {
    if (daysLate > 1) return 'text-red-600';
    if (daysLate === 1) return 'text-yellow-600';
    return 'text-emerald-600';
  };

  useEffect(() => {
    fetchOrders();
    // Poll every 30 seconds for new orders
    const interval = setInterval(fetchOrders, 30000);
    return () => clearInterval(interval);
  }, [techId, activeTab]);

  useEffect(() => {
    if (activeTab === 'current' && allCompletedToday && !hasCelebratedRef.current) {
      confetti({ particleCount: 180, spread: 80, origin: { y: 0.7 } });
      hasCelebratedRef.current = true;
      return;
    }
    if (!allCompletedToday) {
      hasCelebratedRef.current = false;
    }
  }, [allCompletedToday, activeTab]);

  const fetchOrders = async () => {
    try {
      // Fetch orders and filter based on out_of_stock column
      let url = `/api/orders/next?techId=${techId}&all=true`;
      
      // Add filter parameter for out_of_stock
      if (activeTab === 'stock') {
        url += '&outOfStock=true';
      } else {
        url += '&outOfStock=false';
      }

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const unshippedOrders = (data.orders || []).filter((order: Order) => !order.is_shipped);
        setOrders(unshippedOrders);
        if (activeTab === 'current') {
          const stockRes = await fetch(`/api/orders/next?techId=${techId}&all=true&outOfStock=true`);
          if (stockRes.ok) {
            const stockData = await stockRes.json();
            const stockOrders = (stockData.orders || []).filter((order: Order) => !order.is_shipped);
            setGlobalOutOfStockOrders(stockOrders);
          } else {
            setGlobalOutOfStockOrders([]);
          }
        } else {
          setGlobalOutOfStockOrders([]);
        }
        setAllCompletedToday(data.all_completed || false);
        if (data.all_completed && onAllCompleted && activeTab === 'current') {
          onAllCompleted();
        }
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async (order: Order) => {
    try {
      const res = await fetch('/api/orders/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, techId }),
      });
      if (res.ok) {
        // Pass the shipping tracking number to StationTesting to start the work order
        onStart(order.shipping_tracking_number || order.order_id);
        fetchOrders(); // Fetch next orders
      }
    } catch (error) {
      console.error('Error starting order:', error);
    }
  };

  const handleSkip = async (e: React.MouseEvent, orderId: number) => {
    e.stopPropagation();
    try {
      const res = await fetch('/api/orders/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, techId }),
      });
      if (res.ok) {
        fetchOrders();
      }
    } catch (error) {
      console.error('Error skipping order:', error);
    }
  };

  const handleMissingParts = async (orderId: number) => {
    if (!missingPartsReason.trim()) return;
    try {
      const res = await fetch('/api/orders/missing-parts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          orderId,
          reason: missingPartsReason.trim()
        }),
      });
      if (res.ok) {
        onMissingParts(orderId, missingPartsReason.trim());
        setShowMissingPartsInput(null);
        setMissingPartsReason('');
        fetchOrders(); // Fetch next orders
      }
    } catch (error) {
      console.error('Error marking missing parts:', error);
    }
  };

  const renderOrderCard = (order: Order) => {
    const showActions = activeTab === 'current';
    const hasOutOfStock = String(order.out_of_stock || '').trim() !== '';
    const quantity = Math.max(1, parseInt(String(order.quantity || '1'), 10) || 1);
    const openDetails = () => {
      const detail: ShippedOrder = {
        id: order.id,
        ship_by_date: order.ship_by_date || '',
        order_id: order.order_id || '',
        product_title: order.product_title || '',
        item_number: order.item_number || null,
        condition: order.condition || '',
        shipping_tracking_number: order.shipping_tracking_number || '',
        serial_number: '',
        sku: order.sku || '',
        tester_id: Number.isFinite(Number(techId)) ? Number(techId) : null,
        tested_by: null,
        test_date_time: null,
        packer_id: null,
        packed_by: null,
        pack_date_time: null,
        packer_photos_url: [],
        tracking_type: null,
        account_source: order.account_source || null,
        notes: '',
        status_history: [],
        is_shipped: !!order.is_shipped,
        created_at: order.created_at || null,
        quantity: order.quantity || '1',
      };
      window.dispatchEvent(new CustomEvent('open-shipped-details', { detail }));
    };
    return (
    <motion.div
      key={order.id}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      onClick={openDetails}
      className="rounded-2xl p-4 border transition-all relative shadow-sm hover:shadow-md mb-2 bg-white border-gray-200 hover:border-blue-300 cursor-pointer"
    >
      {/* Ship By Date & Order ID Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShipByDate
            date={getDisplayShipByDate(order) || ''}
            showPrefix={false}
            className="[&>span]:text-[14px] [&>span]:font-black [&>svg]:w-4 [&>svg]:h-4"
          />
          <span className={`text-[14px] font-black ${getDaysLateTone(getDaysLateNumber(order.ship_by_date, order.created_at))}`}>
            {getDaysLateNumber(order.ship_by_date, order.created_at)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <PlatformExternalChip
            orderId={order.order_id}
            accountSource={order.account_source}
            canOpen={!!getExternalUrlByItemNumber(order.item_number)}
            onOpen={() => openExternalByItemNumber(order.item_number)}
          />
        </div>
      </div>

      <div className="mb-5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-[13px] font-black ${quantity > 1 ? 'text-yellow-700' : 'text-gray-800'}`}>
              {quantity}
            </span>
            <span className="text-[13px] font-black uppercase tracking-wider text-gray-500">
              -
            </span>
            <span className={`text-[13px] font-black uppercase truncate ${String(order.condition || '').trim().toLowerCase() === 'new' ? 'text-yellow-700' : 'text-gray-800'}`}>
              {order.condition || 'No Condition'}
            </span>
          </div>
          <span className="text-[13px] font-mono font-black text-gray-700 px-1.5 py-0.5 rounded border border-gray-300">
            #{getOrderIdLast4(order.order_id)}
          </span>
        </div>
        <h4 className="text-base font-black text-gray-900 leading-tight">
          {order.product_title}
        </h4>
      </div>

      {hasOutOfStock && (
        <OutOfStockField
          value={String(order.out_of_stock || '')}
          className="mb-4"
        />
      )}

      {hasOutOfStock && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleStart(order);
            }}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-600/20"
          >
            <Play className="w-4 h-4" />
            Start
          </button>
        </div>
      )}

      {/* Action Buttons Row - bottom for safer tapping */}
      {showActions && !hasOutOfStock && (
        <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-3">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMissingPartsInput(showMissingPartsInput === order.id ? null : order.id);
              }}
              className="flex-1 py-3 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all"
            >
              Out of Stock
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleStart(order);
              }}
              className="flex items-center justify-center gap-2 px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-600/20"
            >
              <Play className="w-4 h-4" />
              Start
            </button>
          </div>

          <AnimatePresence>
            {showMissingPartsInput === order.id && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="flex flex-col gap-2 pt-1">
                  <input
                    type="text"
                    value={missingPartsReason}
                    onChange={(e) => setMissingPartsReason(e.target.value)}
                    placeholder="What parts are missing?"
                    className="w-full px-3 py-2 bg-white border border-orange-200 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-orange-500 placeholder:text-gray-400"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMissingPartsInput(null);
                      }}
                      className="flex-1 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMissingParts(order.id);
                      }}
                      disabled={!missingPartsReason.trim()}
                      className="flex-1 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-[9px] font-black uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      Submit
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
    );
  };

  if (loading) {
    return (
      <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-20 mb-3"></div>
        <div className="h-20 bg-gray-200 rounded"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-2">
      {/* Tab Switcher */}
      <TabSwitch
        tabs={[
          { id: 'current', label: 'Current', color: 'blue' },
          { id: 'stock', label: 'Stock', color: 'orange' }
        ]}
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab as 'current' | 'stock')}
      />

      {/* Content Area */}
      {allCompletedToday && activeTab === 'current' ? (
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-emerald-50 rounded-2xl p-8 border-2 border-emerald-200 text-center space-y-4"
        >
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-2">
            <Check className="w-8 h-8 text-emerald-600" />
          </div>
          <h3 className="text-sm font-black text-emerald-900 uppercase tracking-widest leading-tight">
            All orders have been completed today!
          </h3>
          <p className="text-[10px] font-bold text-emerald-600/70 uppercase tracking-widest">
            Great job!
          </p>
        </motion.div>
      ) : orders.length === 0 ? (
        <div className="space-y-3">
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-200 text-center">
            <Package className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
              {activeTab === 'stock' ? 'No out-of-stock orders' : 'No current orders'}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          <AnimatePresence mode="popLayout">
            {orders.map((order) => renderOrderCard(order))}
          </AnimatePresence>
        </div>
      )}

      {activeTab === 'current' && globalOutOfStockOrders.length > 0 && (
        <div>
          <p className="text-[14px] font-black text-amber-700 uppercase tracking-widest mb-2">
            Out of Stock Orders
          </p>
          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {globalOutOfStockOrders.map((order) => renderOrderCard(order))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
