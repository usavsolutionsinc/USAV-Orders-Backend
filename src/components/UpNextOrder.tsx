'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, Play, Package, Calendar, X, Check } from './Icons';

interface Order {
  id: number;
  ship_by_date: string;
  order_id: string;
  product_title: string;
  sku: string;
  urgent: boolean;
  status: string;
  shipping_tracking_number: string;
}

interface UpNextOrderProps {
  techId: string;
  onStart: (tracking: string) => void;
  onMissingParts: (orderId: number, reason: string) => void;
  onAllCompleted?: () => void;
  showAllPending?: boolean;
  showOnlyOutOfStock?: boolean;
}

export default function UpNextOrder({ techId, onStart, onMissingParts, onAllCompleted, showAllPending = false, showOnlyOutOfStock = false }: UpNextOrderProps) {
  const [nextOrder, setNextOrder] = useState<Order | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [allCompletedToday, setAllCompletedToday] = useState(false);
  const [showMissingPartsInput, setShowMissingPartsInput] = useState<number | null>(null);
  const [missingPartsReason, setMissingPartsReason] = useState('');

  useEffect(() => {
    fetchOrders();
    // Poll every 30 seconds for new orders
    const interval = setInterval(fetchOrders, 30000);
    return () => clearInterval(interval);
  }, [techId, showAllPending, showOnlyOutOfStock]);

  const fetchOrders = async () => {
    try {
      let url = `/api/orders/next?techId=${techId}`;
      if (showAllPending || showOnlyOutOfStock) {
        url += '&all=true';
      }
      if (showOnlyOutOfStock) {
        url += '&status=missing_parts';
      }

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (showAllPending || showOnlyOutOfStock) {
          setOrders(data.orders || []);
        } else {
          setNextOrder(data.order || null);
        }
        setAllCompletedToday(data.all_completed || false);
        if (data.all_completed && onAllCompleted && !showOnlyOutOfStock) {
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

  const renderOrderCard = (order: Order, isNext: boolean = false) => (
    <motion.div
      key={order.id}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className={`rounded-2xl p-5 border transition-all relative shadow-sm hover:shadow-md ${
        order.urgent
          ? 'bg-gradient-to-br from-red-50 to-orange-50 border-red-200 ring-2 ring-red-500/10'
          : 'bg-white border-gray-200 hover:border-blue-300'
      } ${!isNext ? 'mb-3' : ''}`}
    >
      {/* Ship By Date & Order ID Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Calendar className="w-3 h-3 text-blue-600" />
          <span className="text-[9px] font-bold text-blue-700">
            Ship By: {order.ship_by_date || 'N/A'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {order.urgent && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-red-600 text-white rounded shadow-sm">
              <AlertCircle className="w-3 h-3" />
              <span className="text-[8px] font-black uppercase tracking-wider">Urgent</span>
            </div>
          )}
          {showOnlyOutOfStock && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-500 text-white rounded shadow-sm">
              <AlertCircle className="w-3 h-3" />
              <span className="text-[8px] font-black uppercase tracking-wider">Out of Stock</span>
            </div>
          )}
          <span className="text-[9px] font-mono font-black text-gray-700">
            #{order.order_id}
          </span>
        </div>
      </div>

      {/* Action Buttons Row */}
      {!showOnlyOutOfStock && (
        <div className="flex flex-col gap-2 mb-5">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowMissingPartsInput(showMissingPartsInput === order.id ? null : order.id)}
              className="flex-1 py-3 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all"
            >
              Out of Stock
            </button>
            <button
              onClick={() => handleStart(order)}
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
                      onClick={() => setShowMissingPartsInput(null)}
                      className="flex-1 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleMissingParts(order.id)}
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

      {/* Product Title */}
      <div className="mb-4">
        <h4 className="text-base font-black text-gray-900 leading-tight">
          {order.product_title}
        </h4>
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-2 gap-3">
        {order.shipping_tracking_number && (
          <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">
              Tracking #
            </p>
            <p className="text-xs font-mono font-bold text-gray-800">
              {order.shipping_tracking_number.slice(-4)}
            </p>
          </div>
        )}
        <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
          <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">
            SKU
          </p>
          <p className="text-xs font-mono font-bold text-gray-800">
            {order.sku}
          </p>
        </div>
      </div>
    </motion.div>
  );

  if (loading) {
    return (
      <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-20 mb-3"></div>
        <div className="h-20 bg-gray-200 rounded"></div>
      </div>
    );
  }

  if (allCompletedToday && !showOnlyOutOfStock) {
    return (
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
    );
  }

  if (showAllPending || showOnlyOutOfStock) {
    if (orders.length === 0) {
      return (
        <div className="bg-gray-50 rounded-2xl p-6 border border-gray-200 text-center">
          <Package className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
            {showOnlyOutOfStock ? 'No out-of-stock orders' : 'No pending orders'}
          </p>
        </div>
      );
    }

    return (
      <div className="flex flex-col">
        <AnimatePresence mode="popLayout">
          {orders.map((order) => renderOrderCard(order))}
        </AnimatePresence>
      </div>
    );
  }

  if (!nextOrder) {
    return (
      <div className="bg-gray-50 rounded-2xl p-6 border border-gray-200 text-center">
        <Package className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
          No orders unassigned
        </p>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {renderOrderCard(nextOrder, true)}
    </AnimatePresence>
  );
}
