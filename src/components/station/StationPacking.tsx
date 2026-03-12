'use client';

import React, { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Barcode, AlertCircle, Loader2, Package } from '../Icons';
import { getPackerInputTheme } from '@/utils/staff-colors';
import { formatPSTTimestamp } from '@/utils/date';

interface ActivePackingOrder {
  orderId: string;
  productTitle: string;
  qty: number;
  condition: string;
  tracking: string;
}

interface ActiveFbaScan {
  fnsku: string;
  productTitle: string;
  shipmentRef: string | null;
  actualQty: number;
  expectedQty: number;
  status: string;
  techScannedQty: number;
  packReadyQty: number;
  shippedQty: number;
  availableToShip: number;
  isNew: boolean;  // true if no existing fba_shipment_items row was found (added on-the-fly)
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

// FNSKUs start with X0, B0, or are exactly 10 alphanumeric chars — Amazon barcode pattern
function looksLikeFnsku(value: string): boolean {
  const v = value.trim().toUpperCase();
  return /^X0[A-Z0-9]{8,10}$/.test(v) || /^B0[A-Z0-9]{8,}$/.test(v);
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
  const [activeOrder, setActiveOrder] = useState<ActivePackingOrder | null>(null);
  const [activeFba, setActiveFba] = useState<ActiveFbaScan | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const safeGoal = Math.max(1, Number(goal) || 1);
  const goalProgressPercent = Math.min((todayCount / safeGoal) * 100, 100);
  const remainingToGoal = Math.max(safeGoal - todayCount, 0);
  const activeColor = getPackerInputTheme(themeColor);

  const handleSubmit = async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    const scan = inputValue.trim();
    if (!scan || isLoading) return;

    setIsLoading(true);
    setErrorMessage(null);
    setActiveOrder(null);
    setActiveFba(null);

    try {
      // ── FBA path: FNSKU detected ───────────────────────────────────────────
      if (looksLikeFnsku(scan)) {
        const res = await fetch('/api/fba/items/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fnsku: scan, staff_id: Number(userId), station: 'PACK_STATION' }),
        });
        const data = await res.json();

        if (!res.ok) {
          setErrorMessage(data?.error || 'FBA scan failed');
        } else {
          setActiveFba({
            fnsku: data.fnsku,
            productTitle: data.product_title || scan,
            shipmentRef: data.shipment_ref || null,
            actualQty: data.actual_qty ?? 0,
            expectedQty: data.expected_qty ?? 0,
            status: data.status || 'READY_TO_GO',
            techScannedQty: Number(data?.summary?.tech_scanned_qty ?? 0),
            packReadyQty: Number(data?.summary?.pack_ready_qty ?? 0),
            shippedQty: Number(data?.summary?.shipped_qty ?? 0),
            availableToShip: Number(data?.summary?.available_to_ship ?? 0),
            isNew: !!data.is_new,
          });
          onComplete?.();
          window.dispatchEvent(new CustomEvent('usav-refresh-data'));
        }
      } else {
        // ── Regular packing path ───────────────────────────────────────────
        const res = await fetch('/api/packing-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trackingNumber: scan,
            photos: [],
            packerId: String(userId),
            packerName: userName,
            timestamp: formatPSTTimestamp(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Failed to save packing scan');

        const resolvedScanType = String(data?.trackingType || '').trim() || 'ORDERS';
        if (resolvedScanType === 'ORDERS') {
          setActiveOrder({
            orderId: String(data?.orderId || '').trim(),
            productTitle: String(data?.productTitle || '').trim() || 'Unknown product',
            qty: Math.max(1, Number(data?.qty ?? data?.quantity ?? data?.orderQty ?? 1) || 1),
            condition: String(data?.condition || '').trim() || 'N/A',
            tracking: String(data?.shippingTrackingNumber || scan).trim(),
          });
        }

        onComplete?.();
        if (data.packerRecord?.id) {
          window.dispatchEvent(new CustomEvent('packer-log-added', { detail: data.packerRecord }));
        }
        window.dispatchEvent(new CustomEvent('usav-refresh-data'));
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Scan failed');
    } finally {
      setInputValue('');
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const FBA_STATUS_STYLES: Record<string, string> = {
    PLANNED:        'bg-gray-100 text-gray-600',
    READY_TO_GO:    'bg-emerald-100 text-emerald-700',
    LABEL_ASSIGNED: 'bg-blue-100 text-blue-700',
    SHIPPED:        'bg-purple-100 text-purple-700',
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
            <div className="absolute right-3 bottom-2">
              {isLoading ? (
                <Loader2 className={`w-4 h-4 animate-spin ${activeColor.text}`} />
              ) : (
                <div className="h-6 min-w-6 px-1 bg-white rounded border border-gray-100 shadow-sm flex items-center justify-center">
                  <span className="text-[8px] font-black text-gray-400">ENTER</span>
                </div>
              )}
            </div>
          </form>

          <p className="text-[10px] font-bold text-gray-400 px-1">
            Supports tracking, FNSKU (X0.../B0...), FBA, and <code className="font-mono">SKU:VALUE</code> scans.
          </p>
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

          </AnimatePresence>

          {/* FBA scan result card */}
          <AnimatePresence mode="wait">
            {activeFba && (
              <motion.div
                key={activeFba.fnsku}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="p-4 bg-white rounded-2xl border border-purple-200 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-black text-purple-500 uppercase tracking-widest">FBA Scan</p>
                    {activeFba.isNew && (
                      <span className="text-[9px] font-black bg-amber-100 text-amber-700 border border-amber-200 rounded-lg px-1.5 py-0.5 uppercase tracking-wider">
                        No Plan Found
                      </span>
                    )}
                  </div>
                  {activeFba.shipmentRef && (
                    <span className="text-[10px] font-mono font-black text-purple-700">{activeFba.shipmentRef}</span>
                  )}
                </div>
                <h3 className="text-base font-black text-gray-900 leading-tight">{activeFba.productTitle}</h3>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div className="bg-purple-50 rounded-xl px-3 py-2 border border-purple-100">
                    <p className="text-[9px] font-black text-purple-400 uppercase tracking-wider mb-1">FNSKU</p>
                    <p className="text-[10px] font-mono font-bold text-gray-700 truncate">{activeFba.fnsku}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Scanned</p>
                    <p className="text-xs font-bold text-gray-800 tabular-nums">
                      {activeFba.actualQty}/{activeFba.expectedQty > 0 ? activeFba.expectedQty : '?'}
                    </p>
                  </div>
                  <div className={`rounded-xl px-3 py-2 border ${FBA_STATUS_STYLES[activeFba.status] || 'bg-gray-50 text-gray-600'} border-current/20`}>
                    <p className="text-[9px] font-black uppercase tracking-wider mb-1">Status</p>
                    <p className="text-[10px] font-black uppercase truncate">{activeFba.status.replace('_', ' ')}</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-3">
                  <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Tech</p>
                    <p className="text-xs font-bold text-gray-800 tabular-nums">{activeFba.techScannedQty}</p>
                  </div>
                  <div className="bg-emerald-50 rounded-xl px-3 py-2 border border-emerald-100">
                    <p className="text-[9px] font-black text-emerald-500 uppercase tracking-wider mb-1">Ready</p>
                    <p className="text-xs font-bold text-emerald-700 tabular-nums">{activeFba.packReadyQty}</p>
                  </div>
                  <div className="bg-blue-50 rounded-xl px-3 py-2 border border-blue-100">
                    <p className="text-[9px] font-black text-blue-500 uppercase tracking-wider mb-1">Avail</p>
                    <p className="text-xs font-bold text-blue-700 tabular-nums">{activeFba.availableToShip}</p>
                  </div>
                  <div className="bg-purple-50 rounded-xl px-3 py-2 border border-purple-100">
                    <p className="text-[9px] font-black text-purple-500 uppercase tracking-wider mb-1">Shipped</p>
                    <p className="text-xs font-bold text-purple-700 tabular-nums">{activeFba.shippedQty}</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Regular order scan result */}
          <AnimatePresence mode="wait">
            {activeOrder && !activeFba && (
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
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Qty</p>
                    <p className="text-xs font-bold text-gray-800">{activeOrder.qty}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Condition</p>
                    <p className="text-xs font-bold text-gray-800">{activeOrder.condition}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">TRK #</p>
                    <p className="text-xs font-mono font-bold text-gray-800">{activeOrder.tracking.slice(-4) || '—'}</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-auto pt-6 border-t border-gray-50 text-center">
            <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.3em]">USAV PACK v2.6</p>
          </div>
        </div>
      </div>
    </div>
  );
}
