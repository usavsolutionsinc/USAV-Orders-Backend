'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import UpNextOrder from '../UpNextOrder';
import { Barcode, AlertCircle, Loader2, Package, MapPin, Settings } from '../Icons';
import ActiveStationOrderCard from './ActiveStationOrderCard';
import StationGoalBar from './StationGoalBar';
import { StationScanBar } from './StationScanBar';
import { getStationInputMode, type StationInputMode, useStationTestingController } from '@/hooks/useStationTestingController';

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
  const [fbaFeedback, setFbaFeedback] = useState<FbaFeedback | null>(null);
  const [fbaError, setFbaError] = useState<string | null>(null);
  const [isFbaLoading, setIsFbaLoading] = useState(false);
  const [manualMode, setManualMode] = useState<StationInputMode | null>(null);

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
    reopenLastActiveOrderCard,
  } = useStationTestingController({
    userId,
    userName,
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
        const res = await fetch(`/api/tech/scan-fnsku?fnsku=${encodeURIComponent(fnsku)}&techId=${encodeURIComponent(userId)}`);
        const data = await res.json();
        if (!res.ok || !data.found) {
          setFbaError(data.error || 'FNSKU scan failed');
          return;
        }

        setActiveOrder({
          id: data.order?.id ?? null,
          orderId: data.order?.orderId ?? 'FNSKU',
          productTitle: data.order?.productTitle ?? data.order?.tracking ?? fnsku,
          itemNumber: data.order?.itemNumber ?? null,
          sku: data.order?.sku ?? 'N/A',
          condition: data.order?.condition ?? 'N/A',
          notes: data.order?.notes ?? '',
          tracking: data.order?.tracking ?? fnsku,
          serialNumbers: Array.isArray(data.order?.serialNumbers) ? data.order.serialNumbers : [],
          testDateTime: data.order?.testDateTime ?? null,
          testedBy: data.order?.testedBy ?? null,
          quantity: parseInt(String(data.order?.quantity || 1), 10) || 1,
          shipByDate: data.order?.shipByDate ?? null,
          createdAt: data.order?.createdAt ?? null,
          orderFound: data.orderFound !== false,
        });

        setFbaFeedback({
          fnsku,
          product_title: data.order?.productTitle ?? null,
          asin: data.order?.asin ?? null,
          sku: data.order?.sku ?? null,
          log_id: Number(data.fnskuLogId ?? 0),
          tech_scanned_qty: Number(data.summary?.tech_scanned_qty ?? 0),
          pack_ready_qty: Number(data.summary?.pack_ready_qty ?? 0),
          shipped_qty: Number(data.summary?.shipped_qty ?? 0),
          available_to_ship: Number(data.summary?.available_to_ship ?? 0),
          shipment_ref: data.shipment?.shipment_ref ?? null,
        });
        triggerGlobalRefresh();
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

      if ((manualMode === 'fba' || manualMode === 'repair') && value.trim()) {
        const detectedMode = getStationInputMode(value);
        if (detectedMode !== manualMode) {
          setManualMode(detectedMode);
        }
      }

      const forcedType =
        typeof overrideTracking === 'string'
          ? 'TRACKING'
          : manualMode === 'tracking'
            ? 'TRACKING'
            : manualMode === 'serial'
              ? 'SERIAL'
              : undefined;

      if (!forcedType && looksLikeFnsku(value)) {
        e?.preventDefault();
        setInputValue('');
        handleFnskuScan(value);
        return;
      }
      handleSubmit(e, overrideTracking, forcedType ? { forcedType } : undefined);
    },
    [inputValue, manualMode, handleFnskuScan, handleSubmit, setInputValue]
  );

  const detectedMode = inputValue.trim() ? getStationInputMode(inputValue) : null;
  const autoMode: StationInputMode = detectedMode ?? (activeOrder ? 'serial' : 'tracking');
  const effectiveMode: StationInputMode =
    manualMode === 'tracking' || manualMode === 'serial'
      ? manualMode
      : manualMode === 'fba'
        ? (detectedMode && detectedMode !== 'fba' ? detectedMode : 'fba')
        : manualMode === 'repair'
          ? (detectedMode && detectedMode !== 'repair' ? detectedMode : 'repair')
        : autoMode;
  const isTrackingMode = effectiveMode === 'tracking';
  const isFbaMode = effectiveMode === 'fba';
  const isRepairMode = effectiveMode === 'repair';
  const isSerialMode = effectiveMode === 'serial';

  const modeBadge = (() => {
    switch (effectiveMode) {
      case 'tracking':
        return {
          label: 'Tracking',
          Icon: MapPin,
          leftDisplayClassName: 'text-blue-600 group-hover:text-blue-700',
        };
      case 'fba':
        return {
          label: 'FBA',
          Icon: Package,
          leftDisplayClassName: 'text-violet-600 group-hover:text-violet-700',
        };
      case 'repair':
        return {
          label: 'Repair',
          Icon: Settings,
          leftDisplayClassName: 'text-amber-600 group-hover:text-amber-700',
        };
      case 'serial':
      default:
        return {
          label: 'Serial',
          Icon: Barcode,
          leftDisplayClassName: 'text-emerald-600 group-hover:text-emerald-700',
        };
    }
  })();
  const ActiveModeIcon = modeBadge.Icon;
  const modeButtonBaseClass =
    'h-6 w-6 rounded-md flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/60';
  const inactiveModeButtonClass = 'text-gray-500 hover:bg-gray-100 hover:text-gray-800';

  const toggleMode = useCallback((nextMode: StationInputMode) => {
    const nextManualMode = manualMode === nextMode ? null : nextMode;
    setManualMode(nextManualMode);

    // Serial mode always targets the last scanned order context and re-opens the card.
    if (nextManualMode === 'serial') {
      reopenLastActiveOrderCard();
    }
  }, [manualMode, reopenLastActiveOrderCard]);

  return (
    <div className={`flex flex-col h-full bg-white overflow-hidden ${embedded ? '' : 'border-r border-gray-100'}`}>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 pb-1 space-y-2">
          <div className="space-y-0.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xl font-black text-gray-900 tracking-tighter">Welcome, {userName}</h2>
            </div>
          </div>

          <StationGoalBar
            count={todayCount}
            goal={goal}
            label="- TODAY'S GOAL"
            colorClass={activeColor.text}
          />

          {/* ── ORDERS mode scan input ── */}
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2"
          >
            <StationScanBar
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleFormSubmit}
              inputRef={inputRef}
              placeholder="ORDERS, FNSKU, RS, SN"
              autoFocus
              icon={(
                <span
                  className="-ml-1 flex items-center justify-center"
                  role="status"
                  aria-label={`Current input mode: ${modeBadge.label}`}
                  title={`Current mode: ${modeBadge.label}`}
                >
                  <ActiveModeIcon className={`h-[17px] w-[17px] transition-colors ${modeBadge.leftDisplayClassName}`} />
                </span>
              )}
              inputClassName={`pl-[2.2rem] focus:ring-4 focus:ring-${themeColor}-500/10 focus:border-${themeColor}-500 pr-32`}
              rightContentClassName="right-1.5 gap-0.5"
              rightContent={(
                <>
                  {(isLoading || isFbaLoading) && (
                    <Loader2 className="h-4 w-4 animate-spin text-gray-700" />
                  )}
                  <div className="flex items-center gap-0">
                    <button
                      type="button"
                      onClick={() => toggleMode('tracking')}
                      aria-pressed={isTrackingMode}
                      aria-label={manualMode === 'tracking' ? 'Tracking mode manual override enabled. Click to return to auto mode.' : 'Switch to tracking mode override.'}
                      title={manualMode === 'tracking' ? 'Tracking mode (manual override). Click again for auto mode.' : 'Tracking mode'}
                      className={`${modeButtonBaseClass} ${isTrackingMode ? 'text-blue-700 bg-blue-50' : inactiveModeButtonClass}`}
                    >
                      <MapPin className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleMode('fba')}
                      aria-pressed={isFbaMode}
                      aria-label={manualMode === 'fba' ? 'FBA mode feedback selected. Regex can still switch modes.' : 'Show FBA mode feedback.'}
                      title={manualMode === 'fba' ? 'FBA feedback mode selected (regex still takes priority)' : 'FBA mode'}
                      className={`${modeButtonBaseClass} ${isFbaMode ? 'text-violet-700 bg-violet-50' : inactiveModeButtonClass}`}
                    >
                      <Package className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleMode('repair')}
                      aria-pressed={isRepairMode}
                      aria-label={manualMode === 'repair' ? 'Repair mode feedback selected. RS- prefix detection can still switch modes.' : 'Show repair service mode feedback.'}
                      title={manualMode === 'repair' ? 'Repair feedback mode selected (regex still takes priority)' : 'Repair mode'}
                      className={`${modeButtonBaseClass} ${isRepairMode ? 'text-amber-700 bg-amber-50' : inactiveModeButtonClass}`}
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleMode('serial')}
                      aria-pressed={isSerialMode}
                      aria-label={manualMode === 'serial' ? 'Serial mode manual override enabled. Click to return to auto mode.' : 'Switch to serial mode override.'}
                      title={manualMode === 'serial' ? 'Serial mode (manual override). Click again for auto mode.' : 'Serial mode'}
                      className={`${modeButtonBaseClass} ${isSerialMode ? 'text-emerald-700 bg-emerald-50' : inactiveModeButtonClass}`}
                    >
                      <Barcode className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              )}
            />

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
                key={activeOrder.tracking}
                activeOrder={activeOrder}
                activeColorTextClass={activeColor.text}
                resolvedManuals={resolvedManuals}
                isManualLoading={isManualLoading}
                onViewManual={onViewManual}
              />
            ) : null}
          </AnimatePresence>

          <motion.div layout className="space-y-2 mt-2">
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
          </motion.div>

          <div className="mt-auto pt-6 border-t border-gray-50 text-center">
            <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.3em]">USAV TECH v2.6</p>
          </div>
        </div>
      </div>
    </div>
  );
}
