'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, Play, Package, Calendar } from './Icons';

interface Order {
  id: number;
  ship_by_date: string;
  order_id: string;
  product_title: string;
  sku: string;
  urgent: boolean;
  status: string;
}

interface UpNextOrderProps {
  techId: string;
  onStart: (orderId: number) => void;
  onMissingParts: (orderId: number) => void;
}

export default function UpNextOrder({ techId, onStart, onMissingParts }: UpNextOrderProps) {
  const [nextOrder, setNextOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchNextOrder();
    // Poll every 30 seconds for new orders
    const interval = setInterval(fetchNextOrder, 30000);
    return () => clearInterval(interval);
  }, [techId]);

  const fetchNextOrder = async () => {
    try {
      const res = await fetch(`/api/orders/next?techId=${techId}`);
      if (res.ok) {
        const data = await res.json();
        setNextOrder(data.order || null);
      }
    } catch (error) {
      console.error('Error fetching next order:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    if (!nextOrder) return;
    try {
      const res = await fetch('/api/orders/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: nextOrder.id }),
      });
      if (res.ok) {
        onStart(nextOrder.id);
        fetchNextOrder(); // Fetch next order
      }
    } catch (error) {
      console.error('Error starting order:', error);
    }
  };

  const handleMissingParts = async () => {
    if (!nextOrder) return;
    try {
      const res = await fetch('/api/orders/missing-parts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: nextOrder.id }),
      });
      if (res.ok) {
        onMissingParts(nextOrder.id);
        fetchNextOrder(); // Fetch next order
      }
    } catch (error) {
      console.error('Error marking missing parts:', error);
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-20 mb-3"></div>
        <div className="h-20 bg-gray-200 rounded"></div>
      </div>
    );
  }

  if (!nextOrder) {
    return (
      <div className="bg-gray-50 rounded-2xl p-6 border border-gray-200 text-center">
        <Package className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
          No orders assigned
        </p>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={nextOrder.id}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        className={`rounded-2xl p-4 border-2 transition-all ${
          nextOrder.urgent
            ? 'bg-red-50 border-red-300 ring-2 ring-red-500/20'
            : 'bg-blue-50 border-blue-200'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest">
            Up Next
          </h3>
          {nextOrder.urgent && (
            <div className="flex items-center gap-1 px-2 py-0.5 bg-red-600 text-white rounded-lg animate-pulse">
              <AlertCircle className="w-3 h-3" />
              <span className="text-[8px] font-black uppercase tracking-wider">Urgent</span>
            </div>
          )}
        </div>

        {/* Action Buttons Row */}
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={handleMissingParts}
            className="flex-1 py-2 bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
          >
            Missing Parts
          </button>
          <button
            onClick={handleStart}
            className="flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-600/30"
          >
            <Play className="w-3 h-3" />
            Start
          </button>
        </div>

        {/* Info Row */}
        <div className="flex items-center justify-between mb-3 text-[10px]">
          <div className="flex items-center gap-1.5 text-gray-600">
            <Calendar className="w-3 h-3" />
            <span className="font-semibold">
              Ship By: {nextOrder.ship_by_date || 'N/A'}
            </span>
          </div>
          <span className="font-mono font-bold text-gray-700">
            #{nextOrder.order_id}
          </span>
        </div>

        {/* Product Title */}
        <div className="mb-2">
          <h4 className="text-sm font-bold text-gray-900 leading-tight">
            {nextOrder.product_title}
          </h4>
        </div>

        {/* SKU */}
        <div className="bg-white/60 rounded-lg px-2 py-1.5 border border-gray-200/50">
          <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-0.5">
            SKU
          </p>
          <p className="text-xs font-mono font-bold text-gray-800">
            {nextOrder.sku}
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
