'use client';

import { useState, useCallback } from 'react';
import { LayoutGroup, AnimatePresence, motion } from 'framer-motion';
import { MobileShell, type MobileShellProps } from '@/design-system/components/mobile/MobileShell';
import { MobileBottomActionBar } from '@/design-system/components/mobile/MobileBottomActionBar';
import { MobileScanSheet } from '@/design-system/components/mobile/MobileScanSheet';
import { MobileUpNextOrder } from './MobileUpNextOrder';
import { MobileQueueFilterSheet } from '../overlays/MobileQueueFilterSheet';
import { HorizontalButtonSlider, SLIDER_PRESETS, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import ActiveStationOrderCard from '@/components/station/ActiveStationOrderCard';
import StationGoalBar from '@/components/station/StationGoalBar';
import { AlertCircle } from '@/components/Icons';
import {
  type StationInputMode,
  useStationTestingController,
} from '@/hooks/useStationTestingController';
import type { StationScanType } from '@/lib/station-scan-routing';
import { looksLikeFnsku } from '@/lib/scan-resolver';
import { useStationTheme } from '@/hooks/useStationTheme';
import { requestCameraPermission } from '@/hooks/useCamera';

// ─── Animation constants ────────────────────────────────────────────────────

const MOBILE_EASE = [0.22, 1, 0.36, 1] as const;
const mobileTween = { duration: 0.24, ease: MOBILE_EASE };
const mobileLayoutTween = { layout: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] } };

// ─── Types ───────────────────────────────────────────────────────────────────

interface MobileStationTestingProps {
  userId: string;
  userName: string;
  staffId: number | string;
  onTrackingScan?: () => void;
  todayCount: number;
  goal?: number;
  onComplete?: () => void;
  onViewManual?: () => void;
  toolbar?: MobileShellProps['toolbar'];
  showQueueSearchOverlay?: boolean;
  /** Forwards to `MobileShell` — use `!h-full min-h-0` when nested under a flex parent (e.g. mobile tech header band). */
  shellClassName?: string;
  /** When true, `MobileShell` renders no top toolbar (parent provides back + staff + view row). */
  suppressShellToolbar?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MobileStationTesting({
  userId,
  userName,
  staffId,
  onTrackingScan,
  todayCount = 0,
  goal = 50,
  onComplete,
  onViewManual,
  toolbar,
  showQueueSearchOverlay = true,
  shellClassName,
  suppressShellToolbar = false,
}: MobileStationTestingProps) {
  const { theme: themeColor, inputBorder } = useStationTheme({ staffId });
  const [manualMode, setManualMode] = useState<StationInputMode | null>(null);
  const [scanSheetOpen, setScanSheetOpen] = useState(false);
  const [queueFilterSheetOpen, setQueueFilterSheetOpen] = useState(false);
  // ── UpNext filter state (owned here, passed to MobileUpNextOrder + MobileSearchOverlay) ──
  const [upNextSearch, setUpNextSearch] = useState('');
  const [upNextFilter, setUpNextFilter] = useState('must_go');
  const [upNextFilterItems, setUpNextFilterItems] = useState<HorizontalSliderItem[]>([
    SLIDER_PRESETS.mustGo, SLIDER_PRESETS.newest, SLIDER_PRESETS.oldest,
  ]);
  const [upNextFilterVariant, setUpNextFilterVariant] = useState<'fba' | 'slate'>('fba');
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

  // ── Mode resolution (same logic as desktop) ──

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

      handleSubmit(
        undefined,
        overrideTracking,
        manualForcedType ? { forcedType: manualForcedType } : undefined,
      );
    },
    [inputValue, manualMode, forcedTypeForManualMode, handleSubmit, setManualMode],
  );

  const handleRemoveSerial = useCallback(
    async (_serial: string, serialIndex: number) => {
      if (!activeOrder) return;
      const nextSerials = activeOrder.serialNumbers.filter((_, idx) => idx !== serialIndex);

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
        ? data.serialNumbers
            .map((row: unknown) => String(row || '').trim().toUpperCase())
            .filter(Boolean)
        : nextSerials;

      setActiveOrder({ ...activeOrder, serialNumbers: savedSerials });
      triggerGlobalRefresh();
    },
    [activeOrder, setActiveOrder, triggerGlobalRefresh, userId],
  );

  // ── Camera scan confirmed ──

  const handleScanConfirmed = useCallback(
    (value: string, type: StationScanType) => {
      setScanSheetOpen(false);
      handleFormSubmit(undefined, value);
    },
    [handleFormSubmit],
  );

  const handleOpenScanSheet = useCallback(() => {
    void requestCameraPermission().finally(() => {
      setScanSheetOpen(true);
    });
  }, []);

  // ── UpNext tab-change handler ──
  const handleUpNextTabChange = useCallback(
    (items: HorizontalSliderItem[], variant: 'fba' | 'slate') => {
      setUpNextFilterItems(items);
      setUpNextFilterVariant(variant);
      setUpNextFilter(items[0]?.id ?? 'all');
    },
    [],
  );

  /** Quick filter slider for bottom bar filter mode (same data as the queue filter sheet). */
  const queueQuickFilterRow =
    showQueueSearchOverlay && upNextFilterItems.length > 0 ? (
      <div className="flex min-h-[36px] w-full min-w-0 flex-1 items-center">
        {upNextFilterItems.length > 1 ? (
          <HorizontalButtonSlider
            items={upNextFilterItems}
            value={upNextFilter}
            onChange={setUpNextFilter}
            variant={upNextFilterVariant}
            size="md"
            aria-label="Filter queue"
          />
        ) : (
          <span className="text-[11px] font-bold text-gray-400">Quick filters load with the queue…</span>
        )}
      </div>
    ) : null;

  // ── Render ──

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <MobileShell
        className={shellClassName}
        toolbar={suppressShellToolbar ? false : (toolbar ?? {
          title: `Welcome, ${userName}`,
          trailing: (
            <span className="text-[11px] font-black text-gray-500 tabular-nums">
              {todayCount}/{goal}
            </span>
          ),
        })}
        bottomDockVariant="overlay"
        bottomDock={
          <MobileBottomActionBar
            chrome="ghost"
            searchValue={inputValue}
            onSearchChange={setInputValue}
            onSearchSubmit={handleFormSubmit}
            searchPlaceholder="Tracking, FNSKU, RS, SN"
            searchExpanded={false}
            searchInputRef={inputRef}
            onQueueFilterPress={() => setQueueFilterSheetOpen(true)}
            showInlineFilterButton={false}
            onScanPress={handleOpenScanSheet}
            pills={queueQuickFilterRow}
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
            label="- TODAY'S GOAL"
            theme={themeColor}
          />

          {/* Error banner */}
          <AnimatePresence mode="wait">
            {errorMessage && !isLoading && (
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

          {/* Active order + Up Next queue */}
          <LayoutGroup id="mobile-station-active-upnext">
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

            <motion.div layout transition={mobileLayoutTween} className="space-y-2 mt-2">
              <MobileUpNextOrder
                techId={userId}
                onStart={(tracking) => {
                  setActiveOrder(null);
                  clearFeedback();
                  setTimeout(() => handleFormSubmit(undefined, tracking), 50);
                }}
                onMissingParts={() => {
                  triggerGlobalRefresh();
                }}
                searchText={upNextSearch}
                quickFilter={upNextFilter}
                onEffectiveTabChange={handleUpNextTabChange}
              />
            </motion.div>
          </LayoutGroup>

          {/* Footer */}
          <div className="pt-6 border-t border-gray-50 text-center">
            <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.3em]">
              USAV TECH MOBILE v1.0
            </p>
          </div>
        </div>
      </MobileShell>

      {/* ── Camera scan sheet ── */}
      <MobileScanSheet
        isOpen={scanSheetOpen}
        onClose={() => setScanSheetOpen(false)}
        onScanConfirmed={handleScanConfirmed}
        manualMode={manualMode}
        onModeChange={(mode) => setManualMode(mode)}
        activeOrderContext={
          activeOrder
            ? { serialNumbers: activeOrder.serialNumbers, quantity: (activeOrder as any).quantity ?? 1 }
            : null
        }
      />

      <MobileQueueFilterSheet
        isOpen={queueFilterSheetOpen}
        onClose={() => setQueueFilterSheetOpen(false)}
        quickFilter={upNextFilter}
        onQuickFilterChange={setUpNextFilter}
        quickFilterItems={upNextFilterItems}
        quickFilterVariant={upNextFilterVariant}
        searchText={upNextSearch}
        onSearchChange={setUpNextSearch}
        placeholder="Search queue..."
      />
    </div>
  );
}
