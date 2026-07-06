'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Barcode, Loader2, Package, MapPin, Settings } from '@/components/Icons';
import { StationScanBar } from '@/components/station/StationScanBar';
import { STATION_SCAN_BAR_MODE_BTN_ARMED } from '@/components/station/scan-bar';
import { ActiveOrderScanFeedback } from '@/components/station/ActiveOrderScanFeedback';
import {
  getStationInputMode,
  type StationInputMode,
  useStationTestingController,
} from '@/hooks/useStationTestingController';
import { looksLikeFnsku } from '@/lib/scan-resolver';
import { useStationTheme } from '@/hooks/useStationTheme';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';

interface ShippingScanBandProps {
  userId: string;
  userName: string;
  staffId: number | string;
  onComplete?: () => void;
  /** When true, renders only the scan bar block (mobile footer). */
  scanOnly?: boolean;
  /** Receives a handler that loads an Up Next order by tracking (Start action). */
  onStartHandlerReady?: (startWithTracking: (tracking: string) => void) => void;
}

/**
 * Shipping-mode scan band — order / FNSKU / repair / serial input. Used by
 * {@link ShippingSidebarPanel} and the legacy {@link StationTesting} embed.
 */
export function ShippingScanBand({
  userId,
  userName,
  staffId,
  onComplete,
  scanOnly = false,
  onStartHandlerReady,
}: ShippingScanBandProps) {
  const { theme: themeColor, inputBorder } = useStationTheme({ staffId });
  const [manualMode, setManualMode] = useState<StationInputMode | null>(null);

  const {
    inputValue,
    setInputValue,
    isLoading,
    inputRef,
    activeOrder,
    setActiveOrder,
    handleSubmit,
    clearFeedback,
    reopenLastActiveOrderCard,
  } = useStationTestingController({
    userId,
    userName,
    onComplete,
    themeColor,
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
      if (!trimmedValue && typeof overrideTracking !== 'string') return;

      const fromUpNextTracking = typeof overrideTracking === 'string';
      const manualForcedType = fromUpNextTracking
        ? 'TRACKING'
        : forcedTypeForManualMode(manualMode);

      const hadManualOverride = manualMode !== null && !fromUpNextTracking;
      if (trimmedValue && hadManualOverride && manualForcedType) {
        setManualMode(null);
      }

      const isFnskuInput = Boolean(trimmedValue) && looksLikeFnsku(trimmedValue);
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
    [inputValue, manualMode, forcedTypeForManualMode, handleSubmit],
  );

  useEffect(() => {
    if (!onStartHandlerReady) return;
    onStartHandlerReady((tracking) => {
      setActiveOrder(null);
      clearFeedback();
      setTimeout(() => handleFormSubmit(undefined, tracking), 50);
    });
  }, [onStartHandlerReady, setActiveOrder, clearFeedback, handleFormSubmit]);

  const trimmedInput = inputValue.trim();
  const detectedMode = trimmedInput ? getStationInputMode(inputValue) : null;
  const autoMode: StationInputMode = detectedMode ?? (activeOrder ? 'serial' : 'tracking');
  const effectiveMode: StationInputMode =
    manualMode ?? (trimmedInput && detectedMode ? detectedMode : autoMode);

  const isTrackingArmed = manualMode === 'tracking';
  const isFbaArmed = manualMode === 'fba';
  const isRepairArmed = manualMode === 'repair';
  const isSerialArmed = manualMode === 'serial';

  const modeBadge = (() => {
    switch (effectiveMode) {
      case 'tracking':
        return { label: 'Tracking', Icon: MapPin, tint: 'text-blue-600 group-hover:text-blue-700' };
      case 'fba':
        return { label: 'FBA', Icon: Package, tint: 'text-violet-600 group-hover:text-violet-700' };
      case 'repair':
        return { label: 'Repair', Icon: Settings, tint: 'text-amber-600 group-hover:text-amber-700' };
      case 'serial':
      default:
        return { label: 'Serial', Icon: Barcode, tint: 'text-emerald-600 group-hover:text-emerald-700' };
    }
  })();
  const ActiveModeIcon = modeBadge.Icon;
  const modeButtonBaseClass =
    'relative h-6 w-6 rounded-md flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-emphasis/60';
  const inactiveModeButtonClass = 'relative z-base text-text-soft hover:bg-surface-sunken hover:text-text-default';

  const toggleMode = useCallback(
    (nextMode: StationInputMode) => {
      const togglingOff = manualMode === nextMode;
      const nextManualMode = togglingOff ? null : nextMode;
      setManualMode(nextManualMode);
      if (nextManualMode === 'serial') reopenLastActiveOrderCard();
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
    [manualMode, inputValue, inputRef, forcedTypeForManualMode, handleSubmit, reopenLastActiveOrderCard],
  );

  const scanBarBlock = (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 120 }}
      className="space-y-2"
    >
      <StationScanBar
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleFormSubmit}
        inputRef={inputRef}
        inputBorderClassName={inputBorder}
        placeholder="ORDERS, FNSKU, RS, SN"
        autoFocus
        icon={(
          <HoverTooltip label={`Current mode: ${modeBadge.label}`} asChild>
            <span className="flex items-center justify-center" role="status" aria-label={`Current input mode: ${modeBadge.label}`}>
              <ActiveModeIcon className={`h-[17px] w-[17px] transition-colors ${modeBadge.tint}`} />
            </span>
          </HoverTooltip>
        )}
        inputClassName={`focus:ring-4 focus:ring-${themeColor}-500/10 focus:border-${themeColor}-500 pr-32`}
        rightContentClassName="right-1.5 gap-0.5"
        rightContent={(
          <>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-text-muted" /> : null}
            <div className="flex items-center gap-0">
              <HoverTooltip label={isTrackingArmed ? 'Tracking armed — next Enter/scan. Click again to cancel.' : 'Tracking (next Enter/scan; or send now if field has text)'} asChild>
                <IconButton icon={<MapPin className="h-3.5 w-3.5" />} onClick={() => toggleMode('tracking')} aria-pressed={isTrackingArmed} ariaLabel="Arm tracking mode" className={`${modeButtonBaseClass} ${isTrackingArmed ? `${STATION_SCAN_BAR_MODE_BTN_ARMED} text-blue-700 bg-blue-50` : inactiveModeButtonClass}`} />
              </HoverTooltip>
              <HoverTooltip label={isFbaArmed ? 'FBA armed — next Enter/scan. Click again to cancel.' : 'FBA (next Enter/scan; or send now if field has text)'} asChild>
                <IconButton icon={<Package className="h-3.5 w-3.5" />} onClick={() => toggleMode('fba')} aria-pressed={isFbaArmed} ariaLabel="Arm FBA mode" className={`${modeButtonBaseClass} ${isFbaArmed ? `${STATION_SCAN_BAR_MODE_BTN_ARMED} text-violet-700 bg-violet-50` : inactiveModeButtonClass}`} />
              </HoverTooltip>
              <HoverTooltip label={isRepairArmed ? 'Repair armed — next Enter/scan. Click again to cancel.' : 'Repair (next Enter/scan; or send now if field has text)'} asChild>
                <IconButton icon={<Settings className="h-3.5 w-3.5" />} onClick={() => toggleMode('repair')} aria-pressed={isRepairArmed} ariaLabel="Arm repair mode" className={`${modeButtonBaseClass} ${isRepairArmed ? `${STATION_SCAN_BAR_MODE_BTN_ARMED} text-amber-700 bg-amber-50` : inactiveModeButtonClass}`} />
              </HoverTooltip>
              <HoverTooltip label={isSerialArmed ? 'Serial armed — next Enter/scan. Click again to cancel.' : 'Serial (next Enter/scan; or send now if field has text)'} asChild>
                <IconButton icon={<Barcode className="h-3.5 w-3.5" />} onClick={() => toggleMode('serial')} aria-pressed={isSerialArmed} ariaLabel="Arm serial mode" className={`${modeButtonBaseClass} ${isSerialArmed ? `${STATION_SCAN_BAR_MODE_BTN_ARMED} text-emerald-700 bg-emerald-50` : inactiveModeButtonClass}`} />
              </HoverTooltip>
            </div>
          </>
        )}
      />
    </motion.div>
  );

  if (scanOnly) {
    return (
      <div className={`min-w-0 space-y-2 ${SIDEBAR_GUTTER} px-1.5`}>
        <ActiveOrderScanFeedback activeOrder={activeOrder} />
        {scanBarBlock}
      </div>
    );
  }

  return (
    <div className={`shrink-0 min-w-0 space-y-2 ${SIDEBAR_GUTTER} py-1.5`}>
      {scanBarBlock}
      <ActiveOrderScanFeedback activeOrder={activeOrder} />
    </div>
  );
}
