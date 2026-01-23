'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, Loader2, AlertCircle, Check } from './Icons';

interface CurrentWorkOrderProps {
  trackingNumber: string | null;
  capturedSerialNumber?: string | null;
  onLoaded: (order: { id: string; productTitle: string; orderId: string; sku?: string; condition?: string; serialNumber?: string } | null) => void;
}

export default function CurrentWorkOrder({ trackingNumber, capturedSerialNumber, onLoaded }: CurrentWorkOrderProps) {
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!trackingNumber || trackingNumber.trim() === '') {
      setOrder(null);
      setError(null);
      onLoaded(null);
      return;
    }

    fetchOrder();
  }, [trackingNumber]);

  const fetchOrder = async () => {
    if (!trackingNumber) return;

    setLoading(true);
    setError(null);

    try {
      // Search for the order in the shipped table using the last 8 digits
      const last8 = trackingNumber.slice(-8).toLowerCase();
      const res = await fetch(`/api/shipped/search?q=${encodeURIComponent(last8)}`);
      
      if (!res.ok) {
        throw new Error('Failed to fetch order');
      }

      const data = await res.json();
      
      if (data.results && data.results.length > 0) {
        const foundOrder = data.results[0];
        const orderData = {
          id: foundOrder.id?.toString() || '',
          productTitle: foundOrder.product_title || foundOrder.customer || 'Unknown Product',
          orderId: foundOrder.order_id || 'N/A',
          sku: foundOrder.sku || 'N/A',
          condition: foundOrder.condition || 'N/A',
          serialNumber: foundOrder.serial_number || null
        };
        
        setOrder(orderData);
        onLoaded(orderData);
      } else {
        setError('No shipped order found for this tracking number');
        setOrder(null);
        onLoaded(null);
      }
    } catch (err) {
      console.error('Error fetching order:', err);
      setError('Failed to load order information');
      setOrder(null);
      onLoaded(null);
    } finally {
      setLoading(false);
    }
  };

  // Don't render anything if no tracking number
  if (!trackingNumber || trackingNumber.trim() === '') {
    return null;
  }

  return (
    <AnimatePresence mode="wait">
      {loading && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="p-4 bg-blue-50 rounded-2xl border border-blue-100"
        >
          <div className="flex items-center gap-3">
            <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
            <p className="text-xs font-bold text-blue-600">Loading current work order...</p>
          </div>
        </motion.div>
      )}

      {!loading && error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="p-4 bg-amber-50 rounded-2xl border border-amber-200"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-amber-900">{error}</p>
              <p className="text-[10px] text-amber-700 mt-1">Tracking: {trackingNumber}</p>
            </div>
          </div>
        </motion.div>
      )}

      {!loading && order && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="p-5 bg-emerald-50 rounded-2xl border-2 border-emerald-200"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
            <h3 className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">
              Current Work Order
            </h3>
            <Check className="w-3.5 h-3.5 text-emerald-600 ml-auto" />
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-xs font-bold text-gray-900 leading-tight mb-2">
                {order.productTitle}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 bg-white/60 backdrop-blur-sm rounded-xl border border-emerald-100/50">
                <p className="text-[9px] font-black text-gray-400 uppercase mb-1">Order ID</p>
                <p className="text-xs font-mono font-bold text-gray-900 truncate">{order.orderId}</p>
              </div>
              <div className="p-3 bg-white/60 backdrop-blur-sm rounded-xl border border-emerald-100/50">
                <p className="text-[9px] font-black text-gray-400 uppercase mb-1">SKU</p>
                <p className="text-xs font-mono font-bold text-gray-900 truncate">{order.sku}</p>
              </div>
            </div>

            {order.condition && order.condition !== 'N/A' && (
              <div className="p-3 bg-white/60 backdrop-blur-sm rounded-xl border border-emerald-100/50">
                <p className="text-[9px] font-black text-gray-400 uppercase mb-1">Condition</p>
                <p className="text-xs font-semibold text-gray-900">{order.condition}</p>
              </div>
            )}

            {(capturedSerialNumber || order.serialNumber) && (
              <div className="p-3 bg-emerald-600 text-white rounded-xl shadow-lg shadow-emerald-600/20 col-span-2">
                <p className="text-[9px] font-black uppercase opacity-80 mb-1">Captured Serial Number</p>
                <p className="text-sm font-mono font-black">{capturedSerialNumber || order.serialNumber}</p>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
