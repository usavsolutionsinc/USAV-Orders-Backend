'use client';

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { motionBezier } from '@/design-system/foundations/motion-framer';
import { ShippingRecentRail } from '@/components/sidebar/shipping/ShippingRecentRail';
import { Barcode, Loader2, Package, MapPin, Settings } from '../Icons';
import { StationScanBar } from './StationScanBar';
import { STATION_SCAN_BAR_MODE_BTN_ARMED } from '@/components/station/scan-bar';
import { ActiveOrderScanFeedback } from './ActiveOrderScanFeedback';
import { getStationInputMode, type StationInputMode, useStationTestingController } from '@/hooks/useStationTestingController';
import { looksLikeFnsku } from '@/lib/scan-resolver';
import { useStationTheme } from '@/hooks/useStationTheme';
import { useIsMobile } from '@/hooks';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';

const STATION_EASE_OUT = motionBezier.easeOut;
const STATION_EASE_HEIGHT = [0.25, 0.1, 0.25, 1] as const;
const stationTween = { duration: 0.26, ease: STATION_EASE_OUT };
const stationLayoutTween = { layout: { duration: 0.32, ease: STATION_EASE_HEIGHT } };

interface StationTestingProps {
  userId: string;
  userName: string;
  staffId: number | string;
  onTrackingScan?: () => void;
  onComplete?: () => void;
  embedded?: boolean;
}

export default function StationTesting({
  userId,
  userName,
  staffId,
  onTrackingScan,
  onComplete,
  embedded = false,
}: StationTestingProps) {
  const { theme: themeColor, inputBorder } = useStationTheme({ staffId });
  const [manualMode, setManualMode] = useState<StationInputMode | null>(null);
  const isMobile = useIsMobile();

  const {
    inputValue,
    setInputValue,
    isLoading,
    inputRef,
    activeOrder,
    setActiveOrder,
    handleSubmit,
    triggerGlobalRefresh,
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

  const trimmedInput = inputValue.trim();
  const detectedMode = trimmedInput ? getStationInputMode(inputValue) : null;
  const autoMode: StationInputMode =
    detectedMode ??
    // Display behavior: once an order is active (including FNSKU-loaded),
    // the next expected input is a serial number.
    (activeOrder ? 'serial' : 'tracking');
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
    'relative h-6 w-6 rounded-md flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-emphasis/60';
  const inactiveModeButtonClass = 'relative z-base text-text-soft hover:bg-surface-sunken hover:text-text-default';

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

  /* ── Scan bar block (shared between desktop-top and mobile-bottom) ── */
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
            <span
              className="flex items-center justify-center"
              role="status"
              aria-label={`Current input mode: ${modeBadge.label}`}
            >
              <ActiveModeIcon className={`h-[17px] w-[17px] transition-colors ${modeBadge.leftDisplayClassName}`} />
            </span>
          </HoverTooltip>
        )}
        inputClassName={`focus:ring-4 focus:ring-${themeColor}-500/10 focus:border-${themeColor}-500 pr-32`}
        rightContentClassName="right-1.5 gap-0.5"
        rightContent={(
          <>
            {isLoading && (
              <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
            )}
            <div className="flex items-center gap-0">
              <HoverTooltip
                label={
                  isTrackingArmed
                    ? 'Tracking armed — next Enter/scan. Click again to cancel.'
                    : 'Tracking (next Enter/scan; or send now if field has text)'
                }
                asChild
              >
                <IconButton
                  icon={<MapPin className="h-3.5 w-3.5" />}
                  onClick={() => toggleMode('tracking')}
                  aria-pressed={isTrackingArmed}
                  ariaLabel={
                    isTrackingArmed
                      ? 'Tracking armed for next Enter or scan. Click again to cancel.'
                      : 'Arm tracking: next Enter or scan uses tracking. If the field already has text, send now.'
                  }
                  className={`${modeButtonBaseClass} ${isTrackingArmed ? `${STATION_SCAN_BAR_MODE_BTN_ARMED} text-blue-700 bg-blue-50` : inactiveModeButtonClass}`}
                />
              </HoverTooltip>
              <HoverTooltip
                label={
                  isFbaArmed
                    ? 'FBA armed — next Enter/scan. Click again to cancel.'
                    : 'FBA (next Enter/scan; or send now if field has text)'
                }
                asChild
              >
                <IconButton
                  icon={<Package className="h-3.5 w-3.5" />}
                  onClick={() => toggleMode('fba')}
                  aria-pressed={isFbaArmed}
                  ariaLabel={
                    isFbaArmed
                      ? 'FBA armed for next Enter or scan. Click again to cancel.'
                      : 'Arm FBA: next Enter or scan uses FNSKU. If the field already has text, send now.'
                  }
                  className={`${modeButtonBaseClass} ${isFbaArmed ? `${STATION_SCAN_BAR_MODE_BTN_ARMED} text-violet-700 bg-violet-50` : inactiveModeButtonClass}`}
                />
              </HoverTooltip>
              <HoverTooltip
                label={
                  isRepairArmed
                    ? 'Repair armed — next Enter/scan. Click again to cancel.'
                    : 'Repair (next Enter/scan; or send now if field has text)'
                }
                asChild
              >
                <IconButton
                  icon={<Settings className="h-3.5 w-3.5" />}
                  onClick={() => toggleMode('repair')}
                  aria-pressed={isRepairArmed}
                  ariaLabel={
                    isRepairArmed
                      ? 'Repair armed for next Enter or scan. Click again to cancel.'
                      : 'Arm repair: next Enter or scan uses RS- ID. If the field already has text, send now.'
                  }
                  className={`${modeButtonBaseClass} ${isRepairArmed ? `${STATION_SCAN_BAR_MODE_BTN_ARMED} text-amber-700 bg-amber-50` : inactiveModeButtonClass}`}
                />
              </HoverTooltip>
              <HoverTooltip
                label={
                  isSerialArmed
                    ? 'Serial armed — next Enter/scan. Click again to cancel.'
                    : 'Serial (next Enter/scan; or send now if field has text)'
                }
                asChild
              >
                <IconButton
                  icon={<Barcode className="h-3.5 w-3.5" />}
                  onClick={() => toggleMode('serial')}
                  aria-pressed={isSerialArmed}
                  ariaLabel={
                    isSerialArmed
                      ? 'Serial armed for next Enter or scan. Click again to cancel.'
                      : 'Arm serial: next Enter or scan adds a serial. If the field already has text, send now.'
                  }
                  className={`${modeButtonBaseClass} ${isSerialArmed ? `${STATION_SCAN_BAR_MODE_BTN_ARMED} text-emerald-700 bg-emerald-50` : inactiveModeButtonClass}`}
                />
              </HoverTooltip>
            </div>
          </>
        )}
      />
    </motion.div>
  );

  return (
    <div className={`flex flex-col h-full bg-surface-card overflow-hidden ${embedded ? '' : 'border-r border-border-hairline'}`}>
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* ── Compact scan band (~40px). Desktop only — on mobile the scan bar
              docks at the bottom (see footer below), so nothing renders up here.
              Scan + active-order strip sit flush on SIDEBAR_GUTTER (6px); the
              gutter gives focus rings + card shadows their breathing room before
              the column’s overflow-hidden edge. ── */}
        {!isMobile && (
          <div className={`shrink-0 min-w-0 space-y-2 ${SIDEBAR_GUTTER} py-1.5`}>
            {scanBarBlock}
            <ActiveOrderScanFeedback activeOrder={activeOrder} />
          </div>
        )}

        {/* ── Scrollable recent rail — same shell as TestingSidebarPanel. ── */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <ShippingRecentRail
            techId={userId}
            onStart={(tracking) => {
              setActiveOrder(null);
              clearFeedback();
              setTimeout(() => handleFormSubmit(undefined, tracking), 50);
            }}
            onMissingParts={() => {
              triggerGlobalRefresh();
            }}
            onAllCompleted={onComplete}
          />
        </div>

        {/* Mobile: scan bar docked at bottom, above safe area. Feedback
            strip sits just above the scan bar so it remains in the tech's
            line of sight after a scan. */}
        {isMobile && (
          <div className={`flex-shrink-0 space-y-2 border-t border-border-hairline bg-surface-card ${SIDEBAR_GUTTER} pb-[max(1.125rem,env(safe-area-inset-bottom))] pt-3`}>
            <div className="min-w-0 space-y-2 px-1.5 pb-2 sm:pb-0">
              <ActiveOrderScanFeedback activeOrder={activeOrder} />
              {scanBarBlock}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
