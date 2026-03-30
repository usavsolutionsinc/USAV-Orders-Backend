'use client';

import React, { useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Barcode, AlertCircle, Package } from '@/components/Icons';
import { getLast4 } from '@/components/ui/CopyChip';
import { useStationTheme } from '@/hooks/useStationTheme';
import { useLast8TrackingSearch } from '@/hooks/useLast8TrackingSearch';
import { formatPSTTimestamp } from '@/utils/date';
import StationGoalBar from '@/components/station/StationGoalBar';
import { looksLikeFnsku } from '@/lib/scan-resolver';
import { MobileShell } from '@/design-system/components/mobile/MobileShell';
import { MobileBottomActionBar } from '@/design-system/components/mobile/MobileBottomActionBar';
import { MobileScanSheet } from '@/design-system/components/mobile/MobileScanSheet';

// ─── Types (same as desktop StationPacking) ─────────────────────────────────

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
  isNew: boolean;
}

interface MobileStationPackingProps {
  userId: string;
  userName: string;
  staffId: number | string;
  todayCount: number;
  goal?: number;
  onComplete?: () => void;
}

// ─── Animation ──────────────────────────────────────────────────────────────

const MOBILE_EASE = [0.22, 1, 0.36, 1] as const;
const mobileTween = { duration: 0.24, ease: MOBILE_EASE };

// ─── Component ──────────────────────────────────────────────────────────────

export function MobileStationPacking({
  userId,
  userName,
  staffId,
  todayCount = 0,
  goal = 50,
  onComplete,
}: MobileStationPackingProps) {
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeOrder, setActiveOrder] = useState<ActivePackingOrder | null>(null);
  const [activeFba, setActiveFba] = useState<ActiveFbaScan | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [scanSheetOpen, setScanSheetOpen] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);

  const { theme: themeColor } = useStationTheme({ staffId });
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
            combinedPackScannedQty: Number(data.combined_pack_scanned_qty ?? data.actual_qty ?? 0),
            isNew: !!data.is_new,
          });
          onComplete?.();
          window.dispatchEvent(new CustomEvent('usav-refresh-data'));
        }
      } else {
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

  const handleScanConfirmed = useCallback(
    (value: string) => {
      setScanSheetOpen(false);
      setInputValue(value);
      // Trigger submit on next tick so inputValue is set
      setTimeout(() => handleSubmit(), 0);
    },
    [handleSubmit],
  );

  return (
    <>
      <MobileShell
        toolbar={{
          title: `Welcome, ${userName}`,
          trailing: (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black text-gray-500 tabular-nums">
                {todayCount}/{goal}
              </span>
              <div className="p-2 bg-gray-900 text-white rounded-xl">
                <Package className="w-3.5 h-3.5" />
              </div>
            </div>
          ),
        }}
        bottomDock={
          <MobileBottomActionBar
            searchValue={inputValue}
            onSearchChange={setInputValue}
            onSearchSubmit={handleSubmit}
            searchPlaceholder="Scan Tracking, FNSKU, or SKU..."
            searchExpanded={searchExpanded}
            onSearchExpandedChange={setSearchExpanded}
            searchInputRef={inputRef}
            searchIcon={<Barcode className="h-[17px] w-[17px] text-gray-600" />}
            onScanPress={() => setScanSheetOpen(true)}
            isLoading={isLoading}
            themeColor={themeColor}
          />
        }
      >
        {/* ── Scrollable content ── */}
        <div className="px-3 pt-2 pb-4 space-y-3">
          {/* Goal bar */}
          <StationGoalBar
            count={todayCount}
            goal={goal}
            label="PACKED"
            theme={themeColor}
          />

          {/* Error banner */}
          <AnimatePresence mode="wait">
            {errorMessage && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={mobileTween}
                className="p-3 bg-red-50 text-red-700 rounded-2xl border border-red-200 flex items-center gap-3"
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
                    <p className="text-[11px] font-black text-purple-500 uppercase tracking-widest">FBA Scan</p>
                    {activeFba.isNew && (
                      <span className="text-[10px] font-black bg-amber-100 text-amber-700 border border-amber-200 rounded-lg px-2 py-0.5 uppercase tracking-wider">
                        No Plan Found
                      </span>
                    )}
                  </div>
                  {activeFba.shipmentRef && (
                    <span className="text-[11px] font-mono font-black text-purple-700">{activeFba.shipmentRef}</span>
                  )}
                </div>
                <h3 className="text-base font-black text-gray-900 leading-tight">{activeFba.productTitle}</h3>
                <div className="mt-3 flex items-stretch justify-between gap-3 rounded-xl border border-purple-100 bg-purple-50/40 px-3 py-3">
                  <div className="min-w-0 flex-1" title={activeFba.fnsku}>
                    <p className="text-[9px] font-black text-purple-400 uppercase tracking-wider">FNSKU</p>
                    <p className="text-sm font-mono font-black text-gray-900 tabular-nums">{getLast4(activeFba.fnsku)}</p>
                  </div>
                  <div className="flex-1 text-center border-x border-purple-100/80 px-2">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">Planned</p>
                    <p className="text-sm font-black text-gray-900 tabular-nums">
                      {activeFba.plannedQty > 0 ? activeFba.plannedQty : '—'}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1 text-right">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">Scanned</p>
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
                  <p className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Active Order</p>
                  <span className="text-[11px] font-mono font-black text-gray-700">{activeOrder.orderId || 'N/A'}</span>
                </div>
                <h3 className="text-base font-black text-gray-900 leading-tight">{activeOrder.productTitle}</h3>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div className="bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">Qty</p>
                    <p className="text-sm font-bold text-gray-800">{activeOrder.qty}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">Cond</p>
                    <p className="text-sm font-bold text-gray-800">{activeOrder.condition}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">TRK</p>
                    <p className="text-sm font-mono font-bold text-gray-800">{normalizeTrackingQuery(activeOrder.tracking) || '—'}</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Footer */}
          <div className="pt-6 border-t border-gray-50 text-center">
            <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.3em]">USAV PACK MOBILE v1.0</p>
          </div>
        </div>
      </MobileShell>

      {/* ── Camera scan sheet ── */}
      <MobileScanSheet
        isOpen={scanSheetOpen}
        onClose={() => setScanSheetOpen(false)}
        onScanConfirmed={(value) => handleScanConfirmed(value)}
        manualMode={null}
        onModeChange={() => {}}
      />
    </>
  );
}
