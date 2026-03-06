'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import UpNextOrder from '../UpNextOrder';
import { Barcode, AlertCircle, Loader2, Check, Search, Package } from '../Icons';
import ActiveStationOrderCard from './ActiveStationOrderCard';
import { useStationTestingController } from '@/hooks/useStationTestingController';

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

type StationMode = 'ORDERS' | 'FBA_PREP';

interface FbaReadyResult {
  fnsku: string;
  productTitle: string | null;
  asin: string | null;
  shipmentRef: string | null;
  actualQty: number;
  expectedQty: number;
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

  // ── FBA Prep mode state ────────────────────────────────────────────────────
  const [stationMode, setStationMode] = useState<StationMode>('ORDERS');
  const [fbaInput, setFbaInput] = useState('');
  const [fbaLoading, setFbaLoading] = useState(false);
  const [fbaError, setFbaError] = useState<string | null>(null);
  const [fbaSuccess, setFbaSuccess] = useState<string | null>(null);
  const [fbaLastResult, setFbaLastResult] = useState<FbaReadyResult | null>(null);
  // Which shipment is selected for FBA Prep scanning
  const [selectedShipmentId, setSelectedShipmentId] = useState<number | null>(null);
  const [shipments, setShipments] = useState<Array<{ id: number; shipment_ref: string; status: string }>>([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(false);
  const fbaInputRef = useRef<HTMLInputElement>(null);

  const {
    inputValue,
    setInputValue,
    isLoading,
    inputRef,
    activeOrder,
    setActiveOrder,
    errorMessage,
    successMessage,
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

  const fetchActiveShipments = async () => {
    setShipmentsLoading(true);
    try {
      const res = await fetch('/api/fba/shipments?status=PLANNED,READY_TO_GO&limit=20');
      if (res.ok) {
        const data = await res.json();
        setShipments(Array.isArray(data?.shipments) ? data.shipments : []);
      }
    } catch {
      // non-critical
    } finally {
      setShipmentsLoading(false);
    }
  };

  const switchMode = (mode: StationMode) => {
    setStationMode(mode);
    setFbaError(null);
    setFbaSuccess(null);
    setFbaLastResult(null);
    if (mode === 'FBA_PREP') {
      fetchActiveShipments();
      setTimeout(() => fbaInputRef.current?.focus(), 100);
    }
  };

  const handleFbaScan = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const scan = fbaInput.trim();
    if (!scan || fbaLoading) return;

    if (!selectedShipmentId) {
      setFbaError('Select a shipment first before scanning');
      return;
    }

    setFbaLoading(true);
    setFbaError(null);
    setFbaSuccess(null);

    try {
      const res = await fetch('/api/fba/items/ready', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipment_id: selectedShipmentId,
          fnsku: scan,
          staff_id: Number(userId),
          station: 'TECH_STATION',
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setFbaError(data?.error || 'Failed to mark item ready');
      } else {
        const item = data.item;
        setFbaLastResult({
          fnsku: item.fnsku,
          productTitle: item.product_title,
          asin: item.asin,
          shipmentRef: null,
          actualQty: item.actual_qty,
          expectedQty: item.expected_qty,
        });
        setFbaSuccess(`Marked READY — ${item.fnsku} (${item.actual_qty} scanned)`);
        setFbaInput('');
        // Refresh shipment list to update item counts
        fetchActiveShipments();
      }
    } catch (err: any) {
      setFbaError(err?.message || 'Scan failed');
    } finally {
      setFbaLoading(false);
      setTimeout(() => fbaInputRef.current?.focus(), 0);
    }
  };

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

          {/* ── Mode toggle ── */}
          <div className="flex gap-1 p-0.5 bg-gray-100 rounded-xl">
            <button
              type="button"
              onClick={() => switchMode('ORDERS')}
              className={`flex-1 py-1.5 rounded-[10px] text-[10px] font-black uppercase tracking-widest transition-all ${
                stationMode === 'ORDERS'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              Orders
            </button>
            <button
              type="button"
              onClick={() => switchMode('FBA_PREP')}
              className={`flex-1 py-1.5 rounded-[10px] text-[10px] font-black uppercase tracking-widest transition-all ${
                stationMode === 'FBA_PREP'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-gray-400 hover:text-purple-600'
              }`}
            >
              FBA
            </button>
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
          <AnimatePresence mode="wait">
            {stationMode === 'ORDERS' && (
              <motion.div
                key="orders-input"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
              >
                <form onSubmit={handleSubmit} className="relative group">
                  <div className={`absolute left-4 top-1/2 -translate-y-1/2 ${activeColor.text}`}>
                    <Barcode className="w-4 h-4" />
                  </div>
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="Scan Tracking, SKU, or SN..."
                    className={`w-full pl-11 pr-14 py-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-bold focus:ring-4 focus:ring-${themeColor}-500/10 focus:border-${themeColor}-500 outline-none transition-all shadow-inner`}
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

                <AnimatePresence>
                  {trackingNotFoundAlert && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="mt-2 p-3 bg-red-50 text-red-700 rounded-xl border border-red-200 flex items-center gap-2"
                    >
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <p className="text-xs font-bold">{trackingNotFoundAlert}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* ── FBA PREP mode ── */}
            {stationMode === 'FBA_PREP' && (
              <motion.div
                key="fba-input"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-2"
              >
                {/* Shipment selector */}
                <div>
                  <p className="text-[9px] font-black text-purple-500 uppercase tracking-widest mb-1 px-1">Select Shipment</p>
                  {shipmentsLoading ? (
                    <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 rounded-xl border border-purple-100">
                      <Loader2 className="w-3 h-3 animate-spin text-purple-400" />
                      <span className="text-[10px] text-purple-400">Loading shipments...</span>
                    </div>
                  ) : shipments.length === 0 ? (
                    <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 rounded-xl border border-purple-100">
                      <Package className="w-3 h-3 text-purple-300" />
                      <span className="text-[10px] text-purple-400">No active FBA shipments</span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {shipments.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSelectedShipmentId(s.id === selectedShipmentId ? null : s.id)}
                          className={`px-2.5 py-1 rounded-xl text-[10px] font-black border transition-all ${
                            selectedShipmentId === s.id
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-white text-gray-700 border-gray-200 hover:border-purple-400'
                          }`}
                        >
                          {s.shipment_ref}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* FNSKU scan input */}
                <form onSubmit={handleFbaScan} className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-500">
                    <Barcode className="w-4 h-4" />
                  </div>
                  <input
                    ref={fbaInputRef}
                    type="text"
                    value={fbaInput}
                    onChange={(e) => setFbaInput(e.target.value)}
                    placeholder="Scan FNSKU to mark ready..."
                    className="w-full pl-11 pr-14 py-3.5 bg-purple-50 border border-purple-200 rounded-2xl text-xs font-bold focus:ring-4 focus:ring-purple-500/10 focus:border-purple-500 outline-none transition-all shadow-inner"
                    disabled={!selectedShipmentId}
                  />
                  <div className="absolute right-3 bottom-2">
                    {fbaLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                    ) : (
                      <div className="h-6 min-w-6 px-1 bg-white rounded border border-purple-100 shadow-sm flex items-center justify-center">
                        <span className="text-[8px] font-black text-gray-400">ENTER</span>
                      </div>
                    )}
                  </div>
                </form>

                {/* FBA Prep feedback */}
                <AnimatePresence>
                  {fbaError && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="p-3 bg-red-50 text-red-700 rounded-xl border border-red-200 flex items-center gap-2"
                    >
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <p className="text-xs font-bold">{fbaError}</p>
                    </motion.div>
                  )}
                  {fbaSuccess && !fbaError && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="p-3 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-200 flex items-center gap-2"
                    >
                      <Check className="w-4 h-4 flex-shrink-0" />
                      <p className="text-xs font-bold">{fbaSuccess}</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Last scanned item detail */}
                <AnimatePresence>
                  {fbaLastResult && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      className="p-3 bg-white rounded-2xl border border-purple-100 shadow-sm"
                    >
                      <p className="text-[9px] font-black text-purple-400 uppercase tracking-widest mb-1">Last Scanned</p>
                      <p className="text-sm font-black text-gray-900 leading-tight truncate">
                        {fbaLastResult.productTitle || fbaLastResult.fnsku}
                      </p>
                      <div className="mt-2 flex items-center gap-3 text-[10px] font-bold text-gray-500">
                        <span className="font-mono text-gray-400">{fbaLastResult.fnsku}</span>
                        <span className="ml-auto tabular-nums">
                          {fbaLastResult.actualQty}/{fbaLastResult.expectedQty > 0 ? fbaLastResult.expectedQty : '?'} scanned
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-6 space-y-3">
          {/* Orders mode content */}
          {stationMode === 'ORDERS' && (
            <>
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
                    setTimeout(() => handleSubmit(undefined, tracking), 50);
                  }}
                  onMissingParts={() => {
                    triggerGlobalRefresh();
                  }}
                />
              </div>
            </>
          )}

          {/* FBA Prep mode — show UpNextOrder FBA tab only */}
          {stationMode === 'FBA_PREP' && (
            <div className="space-y-2 mt-2">
              <UpNextOrder
                techId={userId}
                onStart={(tracking) => {
                  setActiveOrder(null);
                  clearFeedback();
                  setTimeout(() => handleSubmit(undefined, tracking), 50);
                }}
                onMissingParts={() => {
                  triggerGlobalRefresh();
                }}
              />
            </div>
          )}

          <div className="mt-auto pt-6 border-t border-gray-50 text-center">
            <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.3em]">USAV TECH v2.6</p>
          </div>
        </div>
      </div>
    </div>
  );
}
