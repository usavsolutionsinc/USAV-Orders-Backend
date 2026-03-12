'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import UpNextOrder from '../UpNextOrder';
import { Barcode, AlertCircle, Loader2, Search, Package } from '../Icons';
import ActiveStationOrderCard from './ActiveStationOrderCard';
import { useStationTestingController } from '@/hooks/useStationTestingController';

// FNSKUs start with X0, B0, or are exactly 10 alphanumeric chars — Amazon barcode pattern
function looksLikeFnsku(value: string): boolean {
  const v = value.trim().toUpperCase();
  return /^X0[A-Z0-9]{8,10}$/.test(v) || /^B0[A-Z0-9]{8,}$/.test(v);
}

interface FbaFeedback {
  fnsku: string;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  log_id: number;
  tech_scanned_qty: number;
  pack_ready_qty: number;
  shipped_qty: number;
  available_to_ship: number;
  shipment_ref: string | null;
}

interface StationTestingProps {
  userId: string;
  userName: string;
  themeColor?: 'green' | 'blue' | 'purple' | 'yellow';
  onTrackingScan?: () => void;
  todayCount: number;
  goal?: number;
  onComplete?: () => void;
  embedded?: boolean;
  onViewManual?: () => void;
}

export default function StationTesting({
  userId,
  userName,
  themeColor = 'purple',
  onTrackingScan,
  todayCount = 0,
  goal = 50,
  onComplete,
  embedded = false,
  onViewManual,
}: StationTestingProps) {
  const router = useRouter();
  const safeGoal = Math.max(1, Number(goal) || 1);
  const goalProgressPercent = Math.min((todayCount / safeGoal) * 100, 100);
  const remainingToGoal = Math.max(safeGoal - todayCount, 0);

  const [fbaFeedback, setFbaFeedback] = useState<FbaFeedback | null>(null);
  const [fbaError, setFbaError] = useState<string | null>(null);
  const [isFbaLoading, setIsFbaLoading] = useState(false);

  const {
    inputValue,
    setInputValue,
    isLoading,
    inputRef,
    activeOrder,
    setActiveOrder,
    isActiveOrderVisible,
    errorMessage,
    trackingNotFoundAlert,
    resolvedManuals,
    isManualLoading,
    handleSubmit,
    triggerGlobalRefresh,
    activeColor,
    clearFeedback,
    saveManual,
  } = useStationTestingController({
    userId,
    onComplete,
    themeColor,
    onTrackingScan,
  });

  const handleFnskuScan = useCallback(
    async (raw: string) => {
      const fnsku = raw.trim().toUpperCase();
      setIsFbaLoading(true);
      setFbaFeedback(null);
      setFbaError(null);
      try {
        const res = await fetch('/api/fba/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fnsku,
            source_stage: 'TECH',
            event_type: 'SCANNED',
            staff_id: Number(userId),
            station: 'TECH_STATION',
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          setFbaError(data.error || 'FNSKU scan failed');
          return;
        }
        // Pull live totals for this FNSKU from the summary endpoint
        const summaryRes = await fetch(
          `/api/fba/logs/summary?q=${encodeURIComponent(fnsku)}&limit=1`
        );
        const summaryData = await summaryRes.json();
        const row = summaryData?.rows?.[0];
        setFbaFeedback({
          fnsku,
          product_title: data.fnsku_meta?.product_title ?? row?.product_title ?? null,
          asin: data.fnsku_meta?.asin ?? row?.asin ?? null,
          sku: data.fnsku_meta?.sku ?? row?.sku ?? null,
          log_id: Number(data.log?.id),
          tech_scanned_qty: Number(row?.tech_scanned_qty ?? 0),
          pack_ready_qty: Number(row?.pack_ready_qty ?? 0),
          shipped_qty: Number(row?.shipped_qty ?? 0),
          available_to_ship: Number(row?.available_to_ship ?? 0),
          shipment_ref: row?.shipment_ref ?? null,
        });
      } catch {
        setFbaError('Network error — FNSKU scan could not be saved');
      } finally {
        setIsFbaLoading(false);
      }
    },
    [userId]
  );

  const handleFormSubmit = useCallback(
    (e?: React.FormEvent, overrideTracking?: string) => {
      const value = overrideTracking ?? inputValue;
      if (looksLikeFnsku(value)) {
        e?.preventDefault();
        setInputValue('');
        handleFnskuScan(value);
        return;
      }
      handleSubmit(e, overrideTracking);
    },
    [inputValue, handleFnskuScan, handleSubmit, setInputValue]
  );

  return (
    <div className={`flex flex-col h-full bg-white overflow-hidden ${embedded ? '' : 'border-r border-gray-100'}`}>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 pb-1 space-y-2">
          <div className="space-y-0.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xl font-black text-gray-900 tracking-tighter">Welcome, {userName}</h2>
              <button
                type="button"
                onClick={() => {
                  sessionStorage.setItem('dashboard-focus-search', '1');
                  router.push('/dashboard?pending');
                }}
                className="p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl transition-all active:scale-95 shadow-lg shadow-blue-600/10"
                title="Go to Dashboard"
                aria-label="Go to Dashboard"
              >
                <Search className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="space-y-1.5 px-1">
            <div className="flex items-center justify-between">
              <p className={`text-[9px] font-black ${activeColor.text} tabular-nums`}>{todayCount}/{safeGoal} - TODAY'S GOAL </p>
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

          {/* ── ORDERS mode scan input ── */}
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2"
          >
            <form onSubmit={handleFormSubmit} className="relative group">
              <div className={`absolute left-4 top-1/2 -translate-y-1/2 ${activeColor.text}`}>
                <Barcode className="w-4 h-4" />
              </div>
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Scan Tracking, SKU, SN, or FNSKU..."
                className={`w-full pl-11 pr-14 py-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-bold focus:ring-4 focus:ring-${themeColor}-500/10 focus:border-${themeColor}-500 outline-none transition-all shadow-inner`}
                autoFocus
              />
              <div className="absolute right-3 bottom-2">
                {isLoading || isFbaLoading ? (
                  <Loader2 className={`w-4 h-4 animate-spin ${activeColor.text}`} />
                ) : (
                  <div className="h-6 min-w-6 px-1 bg-white rounded border border-gray-100 shadow-sm flex items-center justify-center">
                    <span className="text-[8px] font-black text-gray-400">ENTER</span>
                  </div>
                )}
              </div>
            </form>

            <AnimatePresence>
              {trackingNotFoundAlert && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  role="status"
                  aria-live="polite"
                  className="mt-2 p-3 bg-red-50 text-red-700 rounded-xl border border-red-200 flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <p className="text-xs font-bold">{trackingNotFoundAlert}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-6 space-y-3">
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

          {/* ── FBA FNSKU scan feedback ── */}
          <AnimatePresence mode="wait">
            {fbaError && (
              <motion.div
                key="fba-error"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="p-3 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                <p className="text-xs font-bold text-red-700">{fbaError}</p>
              </motion.div>
            )}
            {fbaFeedback && !fbaError && (
              <motion.div
                key={`fba-${fbaFeedback.log_id}`}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                className="rounded-2xl border border-orange-200 bg-orange-50 p-3 space-y-2"
              >
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 p-1.5 bg-orange-100 rounded-xl">
                    <Package className="w-3.5 h-3.5 text-orange-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black text-orange-700 uppercase tracking-widest">FBA SCANNED</p>
                    <p className="text-xs font-bold text-gray-900 truncate">
                      {fbaFeedback.product_title || fbaFeedback.fnsku}
                    </p>
                    <p className="text-[10px] font-mono text-gray-500 truncate">{fbaFeedback.fnsku}</p>
                    {fbaFeedback.sku && (
                      <p className="text-[10px] text-gray-400 truncate">SKU: {fbaFeedback.sku}</p>
                    )}
                    {fbaFeedback.shipment_ref && (
                      <p className="text-[10px] text-orange-600 font-bold truncate">
                        Shipment: {fbaFeedback.shipment_ref}
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {[
                    { label: 'TECH', value: fbaFeedback.tech_scanned_qty, color: 'text-blue-600' },
                    { label: 'READY', value: fbaFeedback.pack_ready_qty, color: 'text-green-600' },
                    { label: 'AVAIL', value: fbaFeedback.available_to_ship, color: 'text-orange-600' },
                    { label: 'SHIPPED', value: fbaFeedback.shipped_qty, color: 'text-gray-500' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-white rounded-xl px-1 py-1.5 text-center border border-orange-100">
                      <p className={`text-sm font-black tabular-nums ${color}`}>{value}</p>
                      <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">{label}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {activeOrder && isActiveOrderVisible ? (
              <ActiveStationOrderCard
                activeOrder={activeOrder}
                activeColorTextClass={activeColor.text}
                resolvedManuals={resolvedManuals}
                isManualLoading={isManualLoading}
                onViewManual={onViewManual}
                onSaveManual={({ googleLinkOrFileId, type }) =>
                  saveManual({
                    sku: activeOrder.sku,
                    itemNumber: activeOrder.itemNumber,
                    googleLinkOrFileId,
                    type: type || null,
                  })
                }
              />
            ) : null}
          </AnimatePresence>

          <div className="space-y-2 mt-2">
            <UpNextOrder
              techId={userId}
              onStart={(tracking) => {
                setActiveOrder(null);
                clearFeedback();
                setFbaFeedback(null);
                setFbaError(null);
                setTimeout(() => handleFormSubmit(undefined, tracking), 50);
              }}
              onMissingParts={() => {
                triggerGlobalRefresh();
              }}
            />
          </div>

          <div className="mt-auto pt-6 border-t border-gray-50 text-center">
            <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.3em]">USAV TECH v2.6</p>
          </div>
        </div>
      </div>
    </div>
  );
}
