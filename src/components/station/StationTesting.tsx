'use client';

import { useState, useCallback } from 'react';
import { LayoutGroup, motion, AnimatePresence } from 'framer-motion';
import UpNextOrder from '../UpNextOrder';
import { Barcode, AlertCircle, Loader2, Package, MapPin, Settings } from '../Icons';
import ActiveStationOrderCard from './ActiveStationOrderCard';
import StationGoalBar from './StationGoalBar';
import { StationScanBar } from './StationScanBar';
import { getStationInputMode, type StationInputMode, useStationTestingController } from '@/hooks/useStationTestingController';
import { looksLikeFnsku } from '@/lib/scan-resolver';
import { techStationScanInputBorderClass, type TechStationTheme } from '@/utils/staff-colors';

const STATION_EASE_OUT = [0.22, 1, 0.36, 1] as const;
const STATION_EASE_HEIGHT = [0.25, 0.1, 0.25, 1] as const;
const stationTween = { duration: 0.26, ease: STATION_EASE_OUT };
const stationLayoutTween = { layout: { duration: 0.32, ease: STATION_EASE_HEIGHT } };

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
    onTrackingOrderLoaded: useCallback(() => {
      setManualMode((m) => (m === 'tracking' ? null : m));
    }, []),
    onActiveOrderCardAutoHidden: useCallback(() => {
      setManualMode('tracking');
    }, []),
    onFnskuOrderLoaded: useCallback(() => {
      setManualMode((m) => (m === 'fba' ? null : m));
    }, []),
  });

  const forcedTypeForManualMode = useCallback((mode: StationInputMode | null) => {
    if (mode === 'tracking') return 'TRACKING' as const;
    if (mode === 'serial') return 'SERIAL' as const;
    if (mode === 'fba') return 'FNSKU' as const;
    if (mode === 'repair') return 'REPAIR' as const;
    return undefined;
  }, []);

  const handleFormSubmit = useCallback(
    (e?: React.FormEvent, overrideTracking?: string) => {
      e?.preventDefault();

      const value = overrideTracking ?? inputValue;
      const trimmedValue = value.trim();
      if (!trimmedValue && typeof overrideTracking !== 'string') {
        return;
      }

      const fromUpNextTracking = typeof overrideTracking === 'string';
      const manualForcedType = fromUpNextTracking
        ? 'TRACKING'
        : forcedTypeForManualMode(manualMode);

      // One-shot: after arming a mode with the buttons, the next non-empty submit uses it then returns to auto.
      const hadManualOverride = manualMode !== null && !fromUpNextTracking;
      if (trimmedValue && hadManualOverride && manualForcedType) {
        setManualMode(null);
      }

      const isFnskuInput = Boolean(trimmedValue) && looksLikeFnsku(trimmedValue);

      // In auto mode, FNSKU-looking input routes to the dedicated FBA endpoint.
      // Manual mode now fully overrides auto classification.
      // Route through handleSubmit so the hook's handleFnskuScan runs and calls
      // syncActiveOrderState — this updates lastScannedOrderRef so serials always
      // anchor to the latest FNSKU_SCANNED SAL entry.
      if (isFnskuInput && !fromUpNextTracking && !manualForcedType) {
        handleSubmit(undefined, value, { forcedType: 'FNSKU' });
        return;
      }

      if (manualForcedType === 'FNSKU') {
        handleSubmit(undefined, value, { forcedType: 'FNSKU' });
        return;
      }

      handleSubmit(undefined, overrideTracking, manualForcedType ? { forcedType: manualForcedType } : undefined);
    },
    [inputValue, manualMode, forcedTypeForManualMode, handleSubmit, setManualMode]
  );

  const handleRemoveSerial = useCallback(
    async (_serial: string, serialIndex: number) => {
      if (!activeOrder) return;
      const nextSerials = activeOrder.serialNumbers.filter((_, idx) => idx !== serialIndex);

      // Use new unified serial endpoint with salId when available, fall back to old API
      const useSalPath = activeOrder.salId != null;
      const response = useSalPath
        ? await fetch('/api/tech/serial', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'update',
              salId: activeOrder.salId,
              serials: nextSerials,
              techId: userId,
            }),
          })
        : await fetch('/api/tech/update-serials', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tracking: activeOrder.tracking || null,
              serialNumbers: nextSerials,
              techId: userId,
              fnskuLogId: activeOrder.fnskuLogId ?? null,
            }),
          });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.details || data?.error || 'Failed to remove serial');
      }

      const savedSerials = Array.isArray(data.serialNumbers)
        ? data.serialNumbers.map((row: unknown) => String(row || '').trim().toUpperCase()).filter(Boolean)
        : nextSerials;

      setActiveOrder({
        ...activeOrder,
        serialNumbers: savedSerials,
      });
      triggerGlobalRefresh();
    },
    [activeOrder, setActiveOrder, triggerGlobalRefresh, userId]
  );

  const trimmedInput = inputValue.trim();
  const detectedMode = trimmedInput ? getStationInputMode(inputValue) : null;
  const autoMode: StationInputMode =
    detectedMode ??
    (activeOrder?.sourceType === 'fba' ? 'fba' : activeOrder ? 'serial' : 'tracking');
  // Manual mode is a hard override for display and submit routing.
  const effectiveMode: StationInputMode =
    manualMode ??
    (trimmedInput && detectedMode
      ? detectedMode
      : autoMode);
  const isTrackingArmed = manualMode === 'tracking';
  const isFbaArmed = manualMode === 'fba';
  const isRepairArmed = manualMode === 'repair';
  const isSerialArmed = manualMode === 'serial';

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

  const toggleMode = useCallback(
    (nextMode: StationInputMode) => {
      const togglingOff = manualMode === nextMode;
      const nextManualMode = togglingOff ? null : nextMode;
      setManualMode(nextManualMode);

      if (nextManualMode === 'serial') {
        reopenLastActiveOrderCard();
      }

      const pendingInput = inputValue.trim();
      if (togglingOff || !pendingInput) {
        queueMicrotask(() => inputRef.current?.focus());
        return;
      }

      const forced = forcedTypeForManualMode(nextManualMode);
      if (!forced) {
        queueMicrotask(() => inputRef.current?.focus());
        return;
      }

      const raw = inputValue;
      setManualMode(null);
      if (forced === 'FNSKU') {
        handleSubmit(undefined, raw, { forcedType: 'FNSKU' });
        return;
      }

      handleSubmit(undefined, raw, { forcedType: forced });
    },
    [
      manualMode,
      inputValue,
      inputRef,
      forcedTypeForManualMode,
      handleSubmit,
      reopenLastActiveOrderCard,
      setManualMode,
    ],
  );

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
            theme={themeColor}
          />

          {/* ── ORDERS mode scan input ── */}
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={stationTween}
            className="space-y-2"
          >
            <StationScanBar
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleFormSubmit}
              inputRef={inputRef}
              inputBorderClassName={techStationScanInputBorderClass[themeColor as TechStationTheme]}
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
                  {isLoading && (
                    <Loader2 className="h-4 w-4 animate-spin text-gray-700" />
                  )}
                  <div className="flex items-center gap-0">
                    <button
                      type="button"
                      onClick={() => toggleMode('tracking')}
                      aria-pressed={isTrackingArmed}
                      aria-label={
                        isTrackingArmed
                          ? 'Tracking armed for next Enter or scan. Click again to cancel.'
                          : 'Arm tracking: next Enter or scan uses tracking. If the field already has text, send now.'
                      }
                      title={
                        isTrackingArmed
                          ? 'Tracking armed — next Enter/scan. Click again to cancel.'
                          : 'Arm tracking (next Enter/scan; or send now if field has text)'
                      }
                      className={`${modeButtonBaseClass} ${isTrackingArmed ? 'text-blue-700 bg-blue-50' : inactiveModeButtonClass}`}
                    >
                      <MapPin className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleMode('fba')}
                      aria-pressed={isFbaArmed}
                      aria-label={
                        isFbaArmed
                          ? 'FBA armed for next Enter or scan. Click again to cancel.'
                          : 'Arm FBA: next Enter or scan uses FNSKU. If the field already has text, send now.'
                      }
                      title={
                        isFbaArmed
                          ? 'FBA armed — next Enter/scan. Click again to cancel.'
                          : 'Arm FBA (next Enter/scan; or send now if field has text)'
                      }
                      className={`${modeButtonBaseClass} ${isFbaArmed ? 'text-violet-700 bg-violet-50' : inactiveModeButtonClass}`}
                    >
                      <Package className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleMode('repair')}
                      aria-pressed={isRepairArmed}
                      aria-label={
                        isRepairArmed
                          ? 'Repair armed for next Enter or scan. Click again to cancel.'
                          : 'Arm repair: next Enter or scan uses RS- ID. If the field already has text, send now.'
                      }
                      title={
                        isRepairArmed
                          ? 'Repair armed — next Enter/scan. Click again to cancel.'
                          : 'Arm repair (next Enter/scan; or send now if field has text)'
                      }
                      className={`${modeButtonBaseClass} ${isRepairArmed ? 'text-amber-700 bg-amber-50' : inactiveModeButtonClass}`}
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleMode('serial')}
                      aria-pressed={isSerialArmed}
                      aria-label={
                        isSerialArmed
                          ? 'Serial armed for next Enter or scan. Click again to cancel.'
                          : 'Arm serial: next Enter or scan adds a serial. If the field already has text, send now.'
                      }
                      title={
                        isSerialArmed
                          ? 'Serial armed — next Enter/scan. Click again to cancel.'
                          : 'Arm serial (next Enter/scan; or send now if field has text)'
                      }
                      className={`${modeButtonBaseClass} ${isSerialArmed ? 'text-emerald-700 bg-emerald-50' : inactiveModeButtonClass}`}
                    >
                      <Barcode className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              )}
            />

          </motion.div>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-6 space-y-3">
          <AnimatePresence mode="wait">
            {/* Suppress stale errors while any scan is in-flight so they never
                flash above a freshly-loaded FBA/order card. Errors set after
                loading ends (e.g. serial add failure) still surface correctly. */}
            {errorMessage && !isLoading && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={stationTween}
                className="p-4 bg-red-50 text-red-700 rounded-2xl border border-red-200 flex items-center gap-3"
              >
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <p className="text-xs font-bold">{errorMessage}</p>
              </motion.div>
            )}
          </AnimatePresence>

          <LayoutGroup id="station-active-upnext">
            {/* popLayout: exiting card leaves document flow so Up Next reflows up instead of a dead gap */}
            <AnimatePresence mode="popLayout" initial={false}>
              {activeOrder && isActiveOrderVisible ? (
                <ActiveStationOrderCard
                  key={activeOrder.tracking}
                  activeOrder={activeOrder}
                  activeColorTextClass={activeColor.text}
                  resolvedManuals={resolvedManuals}
                  isManualLoading={isManualLoading}
                  onViewManual={onViewManual}
                  onRemoveSerial={handleRemoveSerial}
                />
              ) : null}
            </AnimatePresence>

            <motion.div layout transition={stationLayoutTween} className="space-y-2 mt-2">
              <UpNextOrder
                techId={userId}
                onStart={(tracking) => {
                  setActiveOrder(null);
                  clearFeedback();
                  setTimeout(() => handleFormSubmit(undefined, tracking), 50);
                }}
                onMissingParts={() => {
                  triggerGlobalRefresh();
                }}
              />
            </motion.div>
          </LayoutGroup>

          <div className="mt-auto pt-6 border-t border-gray-50 text-center">
            <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.3em]">USAV TECH v2.6</p>
          </div>
        </div>
      </div>
    </div>
  );
}
