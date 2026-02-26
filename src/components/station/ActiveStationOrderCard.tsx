'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { ShipByDate } from '../ui/ShipByDate';
import { Check, ClipboardList } from '../Icons';
import type { ActiveStationOrder } from '@/hooks/useStationTestingController';
import { getOrderIdLast4 } from '@/hooks/useStationTestingController';

interface ActiveStationOrderCardProps {
  activeOrder: ActiveStationOrder;
  activeColorTextClass: string;
}

export default function ActiveStationOrderCard({
  activeOrder,
  activeColorTextClass,
}: ActiveStationOrderCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="space-y-4"
    >
      <div className="rounded-2xl p-4 border transition-all relative shadow-sm bg-white border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <ShipByDate date={String(activeOrder.shipByDate || activeOrder.createdAt || '')} />
          <span className="text-[9px] font-mono font-black text-gray-700">#{getOrderIdLast4(activeOrder.orderId)}</span>
        </div>

        <div className="mb-4">
          <h3 className="text-base font-black text-gray-900 leading-tight">{activeOrder.productTitle}</h3>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Tracking #</p>
            <p className="text-xs font-mono font-bold text-gray-800">{String(activeOrder.tracking || '').slice(-4) || '—'}</p>
          </div>
          <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">SKU</p>
            <p className="text-xs font-mono font-bold text-gray-800">{activeOrder.sku}</p>
          </div>
          <div
            className={`rounded-xl px-3 py-2 border ${(activeOrder.quantity || 1) > 1 ? 'bg-yellow-300 border-yellow-400' : 'bg-gray-50 border-gray-100'}`}
          >
            <p
              className={`text-[9px] font-black uppercase tracking-wider mb-1 ${(activeOrder.quantity || 1) > 1 ? 'text-yellow-900' : 'text-gray-400'}`}
            >
              Qty
            </p>
            <p className={`text-xs font-mono font-black ${(activeOrder.quantity || 1) > 1 ? 'text-yellow-900' : 'text-gray-800'}`}>
              {activeOrder.quantity || 1}
            </p>
          </div>
        </div>

        {activeOrder.notes && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ClipboardList className={`w-4 h-4 ${activeColorTextClass}`} />
              <p className="text-[10px] font-black uppercase text-gray-500 tracking-widest">Testing Notes</p>
            </div>
            <p className="text-xs font-medium text-gray-700 bg-white/50 p-4 rounded-2xl border border-white/50 leading-relaxed">
              {activeOrder.notes}
            </p>
          </div>
        )}
      </div>

      {activeOrder.serialNumbers.length > 0 && (
        <div className="rounded-2xl p-4 border border-emerald-100 bg-emerald-50/60 space-y-2">
          <p className="text-[9px] font-black text-emerald-700 uppercase tracking-wider">
            Scanned Serials ({activeOrder.serialNumbers.length})
          </p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {activeOrder.serialNumbers.map((sn, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}
                className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-emerald-100"
              >
                <Check className="w-3 h-3 text-emerald-600 flex-shrink-0" />
                <span className="text-xs font-mono font-bold text-emerald-700">{sn}</span>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
