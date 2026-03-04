'use client';

import React, { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Barcode, AlertCircle, Loader2, Check, Package } from '../Icons';
import { getPackerInputTheme } from '@/utils/staff-colors';

interface ActivePackingOrder {
  orderId: string;
  productTitle: string;
  condition: string;
  tracking: string;
}

interface StationPackingProps {
  userId: string;
  userName: string;
  themeColor?: 'black' | 'red';
  todayCount: number;
  goal?: number;
  onComplete?: () => void;
  embedded?: boolean;
}

function mapStaffIdToPackingStation(staffId: string): string {
  const normalized = String(staffId || '').trim();
  if (normalized === '4') return '1';
  if (normalized === '5') return '2';
  if (normalized === '6') return '3';
  if (normalized === '1' || normalized === '2' || normalized === '3') return normalized;
  return '1';
}

export default function StationPacking({
  userId,
  userName,
  themeColor = 'black',
  todayCount = 0,
  goal = 50,
  onComplete,
  embedded = false,
}: StationPackingProps) {
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [lastScanType, setLastScanType] = useState<string | null>(null);
  const [activeOrder, setActiveOrder] = useState<ActivePackingOrder | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const safeGoal = Math.max(1, Number(goal) || 1);
  const goalProgressPercent = Math.min((todayCount / safeGoal) * 100, 100);
  const remainingToGoal = Math.max(safeGoal - todayCount, 0);
  const activeColor = getPackerInputTheme(themeColor);

  const handleSubmit = async (event?: React.FormEvent, externalInput?: string) => {
    if (event) event.preventDefault();
    const scan = String(externalInput ?? inputValue ?? '').trim();
    if (!scan || isLoading) return;

    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/packing-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackingNumber: scan,
          photos: [],
          packerId: mapStaffIdToPackingStation(userId),
          packerName: userName,
          timestamp: new Date().toISOString(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to save packing scan');
      }

      const resolvedScanType = String(data?.trackingType || '').trim() || 'ORDERS';
      setLastScanType(resolvedScanType);
      if (resolvedScanType === 'ORDERS') {
        setActiveOrder({
          orderId: String(data?.orderId || '').trim(),
          productTitle: String(data?.productTitle || '').trim() || 'Unknown product',
          condition: String(data?.condition || '').trim() || 'N/A',
          tracking: String(data?.shippingTrackingNumber || scan).trim(),
        });
      } else {
        setActiveOrder(null);
      }

      if (data?.warning) {
        setSuccessMessage(String(data.warning));
      } else if (data?.message) {
        setSuccessMessage(String(data.message));
      } else {
        setSuccessMessage(`Packed (${String(data?.trackingType || 'ORDERS')})`);
      }

      setInputValue('');
      onComplete?.();

      // Surgical insert: fire a targeted event so PackerTable can prepend the new
      // row via setQueryData without invalidating/re-fetching the whole list.
      if (data.packerRecord?.id) {
        window.dispatchEvent(new CustomEvent('packer-log-added', { detail: data.packerRecord }));
      }
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch (err: any) {
      setErrorMessage(err?.message || 'Packing scan failed');
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  return (
    <div className={`flex flex-col h-full bg-white overflow-hidden ${embedded ? '' : 'border-r border-gray-100'}`}>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 pb-2 space-y-4">
          <div className="space-y-0.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xl font-black text-gray-900 tracking-tighter">Welcome, {userName}</h2>
              <div className="p-3 bg-gray-900 text-white rounded-2xl shadow-lg shadow-gray-900/10">
                <Package className="w-4 h-4" />
              </div>
            </div>
          </div>

          <div className="space-y-2 px-1">
            <div className="flex items-center justify-between">
              <p className={`text-[9px] font-black ${activeColor.text} tabular-nums`}>{todayCount}/{safeGoal} PACKED</p>
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{remainingToGoal} Left</p>
            </div>
            <div className="h-2 bg-gray-50 rounded-full overflow-hidden border border-gray-100 p-0.5">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${goalProgressPercent}%` }}
                className={`h-full ${activeColor.bg} rounded-full shadow-sm`}
              />
            </div>
          </div>

          <form onSubmit={handleSubmit} className="relative group">
            <div className={`absolute left-4 top-1/2 -translate-y-1/2 ${activeColor.text}`}>
              <Barcode className="w-4 h-4" />
            </div>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Scan Tracking, FNSKU, FBA, or SKU:..."
              className={`w-full pl-11 pr-14 py-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-bold ${activeColor.ring} ${activeColor.border} outline-none transition-all shadow-inner`}
              autoFocus
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {isLoading ? (
                <Loader2 className={`w-4 h-4 animate-spin ${activeColor.text}`} />
              ) : (
                <div className="px-1.5 py-0.5 bg-white rounded border border-gray-100 shadow-sm">
                  <span className="text-[8px] font-black text-gray-400">ENTER</span>
                </div>
              )}
            </div>
          </form>

          <p className="text-[10px] font-bold text-gray-400 px-1">Supports tracking, X0/B0/FBA, and `SKU:VALUE` scans.</p>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-6 space-y-3">
          <AnimatePresence mode="wait">
            {errorMessage && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-4 bg-red-50 text-red-700 rounded-2xl border border-red-200 flex items-center gap-3"
              >
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <p className="text-xs font-bold">{errorMessage}</p>
              </motion.div>
            )}

            {successMessage && !errorMessage && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-4 bg-green-50 text-green-700 rounded-2xl border border-green-200 flex items-center gap-3"
              >
                <Check className="w-5 h-5 flex-shrink-0" />
                <p className="text-xs font-bold">{successMessage}</p>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {activeOrder ? (
              <motion.div
                key={activeOrder.tracking}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="p-4 bg-white rounded-2xl border border-gray-200 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Active Order</p>
                  <span className="text-[10px] font-mono font-black text-gray-700">{activeOrder.orderId || 'N/A'}</span>
                </div>
                <h3 className="text-base font-black text-gray-900 leading-tight">{activeOrder.productTitle}</h3>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Condition</p>
                    <p className="text-xs font-bold text-gray-800">{activeOrder.condition}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Tracking #</p>
                    <p className="text-xs font-mono font-bold text-gray-800">{activeOrder.tracking.slice(-4) || '—'}</p>
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <div className="mt-auto pt-6 border-t border-gray-50 text-center">
            <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.3em]">USAV PACK v2.6</p>
          </div>
        </div>
      </div>
    </div>
  );
}
