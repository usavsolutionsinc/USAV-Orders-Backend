'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Check, Clock, Package } from '../Icons';
import { ShippedRecord } from '@/lib/neon/shipped-queries';
import { formatStatusTimestamp } from '@/lib/neon/status-history';

interface ShippedDetailsPanelProps {
  shipped: ShippedRecord;
  onClose: () => void;
  onUpdate: () => void;
}

export function ShippedDetailsPanel({ 
  shipped, 
  onClose, 
  onUpdate 
}: ShippedDetailsPanelProps) {
  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 120 }}
      className="fixed right-0 top-0 h-screen w-[400px] bg-white border-l border-gray-200 shadow-2xl z-[100] overflow-y-auto"
    >
      {/* Header */}
      <div className="sticky top-0 bg-white/80 backdrop-blur-md border-b border-gray-200 p-6 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                <Package className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-900 tracking-tight leading-none">{shipped.order_id}</h2>
              <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mt-1">Shipment Verified</p>
            </div>
        </div>
        <button 
          onClick={onClose} 
          className="p-2 hover:bg-gray-100 rounded-xl transition-all"
          aria-label="Close details"
        >
          <X className="w-5 h-5 text-gray-600" />
        </button>
      </div>
      
      {/* Content sections */}
      <div className="p-6 space-y-6">
        {/* Shipping Information */}
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
            Shipping Information
          </h3>
          <div className="space-y-3">
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Tracking Number</span>
              <p className="font-mono text-sm text-gray-900 font-semibold">{shipped.shipping_tracking_number || 'Not available'}</p>
            </div>
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Order ID</span>
              <p className="font-mono text-sm text-gray-900 font-semibold">{shipped.order_id || 'Not available'}</p>
            </div>
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Sent Date</span>
              <p className="font-semibold text-sm text-gray-900">{shipped.sent || 'Not set'}</p>
            </div>
          </div>
        </section>

        {/* Product Details */}
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
            Product Details
          </h3>
          <div className="space-y-3">
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Product Title</span>
              <p className="font-semibold text-sm text-gray-900 leading-relaxed">{shipped.product_title || 'Not provided'}</p>
            </div>
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Serial Number</span>
              <p className="font-mono text-sm text-gray-900 font-semibold">{shipped.serial_number || 'N/A'}</p>
            </div>
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">SKU</span>
              <p className="font-mono text-sm text-gray-900 font-semibold">{shipped.sku || 'Not assigned'}</p>
            </div>
          </div>
        </section>

        {/* Packing Information */}
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
            Packing Information
          </h3>
          <div className="space-y-3">
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Boxed By</span>
              <p className="font-semibold text-sm text-gray-900">{shipped.boxed_by || 'Not specified'}</p>
            </div>
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Tested By</span>
              <p className="font-semibold text-sm text-gray-900">{shipped.tested_by || 'Unknown'}</p>
            </div>
          </div>
        </section>

        {/* Current Status */}
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
            Current Status
          </h3>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm font-black uppercase tracking-wider text-blue-900">{shipped.status || 'No status set'}</p>
          </div>
        </section>
        
        {/* Status History */}
        {shipped.status_history && shipped.status_history.length > 0 && (
          <section>
            <h3 className="text-[10px] font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
              Status History
            </h3>
            <div className="space-y-2">
              {shipped.status_history.slice().reverse().map((entry, idx) => {
                const isShippedOrPickedUp = entry.status === 'Shipped' || entry.status === 'Picked Up';
                
                return (
                  <div 
                    key={idx} 
                    className={`flex items-start gap-3 p-3 rounded-lg ${
                      isShippedOrPickedUp ? 'bg-emerald-50 border border-emerald-200' : 'bg-gray-50'
                    }`}
                  >
                    <div className={`mt-0.5 ${isShippedOrPickedUp ? 'text-emerald-600' : 'text-blue-600'}`}>
                      {isShippedOrPickedUp ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <Clock className="w-4 h-4" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={`font-bold text-sm ${isShippedOrPickedUp ? 'text-emerald-900' : 'text-gray-900'}`}>
                        {entry.status}
                      </p>
                      <p className="text-xs text-gray-600 mt-0.5">
                        {formatStatusTimestamp(entry.timestamp)}
                      </p>
                      {entry.previous_status && (
                        <p className="text-[10px] text-gray-500 mt-1">
                          From: {entry.previous_status}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </motion.div>
  );
}
