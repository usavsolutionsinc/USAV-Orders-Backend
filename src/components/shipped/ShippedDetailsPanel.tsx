'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Package } from '../Icons';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { buildShippedCopyInfo } from '@/utils/copyallshipped';
import { DashboardDetailsStack } from './stacks/dashboarddetailsStack';
import { DetailsStackDurationData } from './stacks/types';

interface ShippedDetailsPanelProps {
  shipped: ShippedOrder;
  onClose: () => void;
  onUpdate: () => void;
}

export function ShippedDetailsPanel({
  shipped: initialShipped,
  onClose,
  onUpdate: _onUpdate
}: ShippedDetailsPanelProps) {
  const [shipped, setShipped] = useState<ShippedOrder>(initialShipped);
  const [durationData, setDurationData] = useState<DetailsStackDurationData>({});
  const [copiedAll, setCopiedAll] = useState(false);

  useEffect(() => {
    setShipped(initialShipped);
  }, [initialShipped]);

  useEffect(() => {
    fetchDurations();
  }, [shipped.id]);

  const fetchDurations = async () => {
    setDurationData({});
    try {
      const res = await fetch(`/api/shipped/durations?id=${shipped.id}`);
      if (res.ok) {
        const data = await res.json();
        setDurationData(data);
      }
    } catch (err) {
      console.error('Failed to fetch durations:', err);
    }
  };

  const handleCopyAll = () => {
    const allInfo = buildShippedCopyInfo(shipped);
    navigator.clipboard.writeText(allInfo);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 350, mass: 0.5 }}
      className="fixed right-0 top-0 h-screen w-[420px] bg-white border-l border-gray-200 shadow-[-20px_0_50px_rgba(0,0,0,0.05)] z-[100] overflow-y-auto no-scrollbar"
    >
      <div className="sticky top-0 bg-white/90 backdrop-blur-xl border-b border-gray-100 p-8 flex items-center justify-between z-10">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
              <Package className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-[22px] font-black text-gray-900 tracking-tighter leading-none">{shipped.order_id}</h2>
              <div className="flex items-center gap-2 mt-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em]">Verified Shipment</p>
              </div>
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-3 hover:bg-gray-50 rounded-2xl transition-all border border-transparent hover:border-gray-100"
          aria-label="Close details"
        >
          <X className="w-6 h-6 text-gray-400" />
        </button>
      </div>

      <DashboardDetailsStack
        shipped={shipped}
        durationData={durationData}
        copiedAll={copiedAll}
        onCopyAll={handleCopyAll}
        onUpdate={_onUpdate}
      />
    </motion.div>
  );
}
