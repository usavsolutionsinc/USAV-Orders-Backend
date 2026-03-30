'use client';

import React, { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Barcode, AlertCircle, Loader2, Package } from '../Icons';
import { getLast4 } from '../ui/CopyChip';
import { useStationTheme } from '@/hooks/useStationTheme';
import { useLast8TrackingSearch } from '@/hooks/useLast8TrackingSearch';
import { formatPSTTimestamp } from '@/utils/date';
import StationGoalBar from './StationGoalBar';
import { StationScanBar } from './StationScanBar';
import { looksLikeFnsku } from '@/lib/scan-resolver';

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
  plannedQty: number;
  combinedPackScannedQty: number;
  isNew: boolean; // true if no existing fba_shipment_items row was found (added on-the-fly)
}

interface StationPackingProps {
  userId: string;
  userName: string;
  staffId: number | string;
  todayCount: number;
  goal?: number;
  onComplete?: () => void;
  embedded?: boolean;
}

export default function StationPacking({
  userId,
  userName,
  staffId,
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

  const { theme: themeColor, colors: themeColors, inputBorder, inputTheme: activeColor } = useStationTheme({ staffId });
  const { normalizeTrackingQuery, normalizeTracking } = useLast8TrackingSearch();

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
            plannedQty: Number(data.planned_qty ?? data.expected_qty ?? 0),
            combinedPackScannedQty: Number(
              data.combined_pack_scanned_qty ?? data.actual_qty ?? 0
            ),
            isNew: !!data.is_new,
          });
          onComplete?.();
          window.dispatchEvent(new CustomEvent('usav-refresh-data'));
        }
      } else {
        // ── Regular packing path ───────────────────────────────────────────
        // Pre-normalize: strip USPS IMpb routing prefix (420+ZIP) for tracking inputs.
        // SKU (has `:`) and special commands (clean/FBA-) pass through raw.
        const isTrackingInput = !scan.includes(':') && !/^(clean|fba-)/i.test(scan);
        const normalizedScan = isTrackingInput ? normalizeTracking(scan) : scan;
        const res = await fetch('/api/packing-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trackingNumber: normalizedScan,
            photos: [],
            packerId: String(userId),
            packerName: userName,
            createdAt: formatPSTTimestamp(),
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

  return (
    <div className={`flex flex-col h-full bg-white overflow-hidden ${embedded ? '' : 'border-r border-gray-100'}`}>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 pb-2 space-y-4">
          <div className="space-y-0.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xl font-black text-gray-900 tracking-tighter">Welcome, {userName}</h2>
              <div className={`p-3 ${themeColors.bg} text-white rounded-2xl shadow-lg ${themeColors.shadow}`}>
                <Package className="w-4 h-4" />
              </div>
            </div>
          </div>

          <StationGoalBar
            count={todayCount}
            goal={goal}
            label="PACKED"
            theme={themeColor}
          />

          <StationScanBar
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleSubmit}
            inputRef={inputRef}
            placeholder="Scan Tracking, FNSKU, FBA, or SKU..."
            icon={<Barcode className="w-4 h-4" />}
            iconClassName={activeColor.text}
            inputBorderClassName={inputBorder}
            inputClassName={activeColor.ring}
            autoFocus
            rightContent={(
              <>
                {isLoading ? (
                  <Loader2 className={`w-4 h-4 animate-spin ${activeColor.text}`} />
                ) : (
                  <div className="h-6 min-w-6 px-1 bg-white rounded border border-gray-100 shadow-sm flex items-center justify-center">
                    <span className="text-[8px] font-black text-gray-400">ENTER</span>
                  </div>
                )}
              </>
            )}
          />

          <p className="text-[10px] font-bold text-gray-400 px-1">
            Supports tracking, FNSKU/ASIN (10 chars: <code className="font-mono">X00</code> or <code className="font-mono">B0</code> prefix), FBA, and{' '}
            <code className="font-mono">SKU:VALUE</code> scans.
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
                <div className="mt-3 flex items-stretch justify-between gap-3 rounded-xl border border-purple-100 bg-purple-50/40 px-3 py-2.5">
                  <div className="min-w-0 flex-1" title={activeFba.fnsku}>
                    <p className="text-[8px] font-black text-purple-400 uppercase tracking-wider">FNSKU</p>
                    <p className="text-sm font-mono font-black text-gray-900 tabular-nums">{getLast4(activeFba.fnsku)}</p>
                  </div>
                  <div className="flex-1 text-center border-x border-purple-100/80 px-2">
                    <p className="text-[8px] font-black text-gray-400 uppercase tracking-wider">Planned</p>
                    <p className="text-sm font-black text-gray-900 tabular-nums">
                      {activeFba.plannedQty > 0 ? activeFba.plannedQty : '—'}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1 text-right">
                    <p className="text-[8px] font-black text-gray-400 uppercase tracking-wider">Scanned</p>
                    <p className="text-sm font-black text-gray-900 tabular-nums">
                      {activeFba.combinedPackScannedQty}
                    </p>
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
                    <p className="text-xs font-mono font-bold text-gray-800">{normalizeTrackingQuery(activeOrder.tracking) || '—'}</p>
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
