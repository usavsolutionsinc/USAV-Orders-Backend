'use client';

import { type ReactNode, type FormEvent, type Ref } from 'react';
import { motion } from 'framer-motion';
import { StationScanBar } from '@/components/station/StationScanBar';
import { Barcode, MapPin, Package, Settings, Loader2 } from '@/components/Icons';
import type { StationInputMode } from '@/hooks/useStationTestingController';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MobileStationScanDockProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void;
  inputRef?: Ref<HTMLInputElement>;
  inputBorderClassName?: string;
  isLoading?: boolean;
  /** Icon rendered inside the scan bar's leading slot. */
  scanBarIcon?: ReactNode;
  /** Current effective mode — controls which pill is highlighted. */
  effectiveMode: StationInputMode;
  /** Manual mode override — when non-null, that pill shows "armed". */
  manualMode: StationInputMode | null;
  /** Toggle a manual mode on/off. */
  onToggleMode: (mode: StationInputMode) => void;
  /** Theme color name for focus ring. */
  themeColor?: string;
}

// ─── Mode pill config ────────────────────────────────────────────────────────

const MODE_PILLS: {
  mode: StationInputMode;
  label: string;
  Icon: typeof MapPin;
  activeClass: string;
}[] = [
  { mode: 'tracking', label: 'Track', Icon: MapPin, activeClass: 'bg-blue-600 text-white' },
  { mode: 'serial', label: 'Serial', Icon: Barcode, activeClass: 'bg-emerald-600 text-white' },
  { mode: 'fba', label: 'FBA', Icon: Package, activeClass: 'bg-violet-600 text-white' },
  { mode: 'repair', label: 'Repair', Icon: Settings, activeClass: 'bg-amber-600 text-white' },
];

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * MobileStationScanDock — bottom-docked scan bar for mobile station views.
 *
 * Renders:
 *   1. Horizontal mode-toggle pill bar (scrollable)
 *   2. StationScanBar input (reused from desktop)
 *   3. Safe-area bottom padding for iOS
 */
export function MobileStationScanDock({
  value,
  onChange,
  onSubmit,
  inputRef,
  inputBorderClassName,
  isLoading = false,
  scanBarIcon,
  effectiveMode,
  manualMode,
  onToggleMode,
  themeColor = 'gray',
}: MobileStationScanDockProps) {
  return (
    <div className="bg-white border-t border-gray-100 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {/* ── Mode toggle pills ── */}
      <div className="flex items-center gap-1.5 mb-2 overflow-x-auto no-scrollbar">
        {MODE_PILLS.map(({ mode, label, Icon, activeClass }) => {
          const isArmed = manualMode === mode;
          const isActive = effectiveMode === mode && manualMode === null;

          return (
            <button
              key={mode}
              type="button"
              onClick={() => onToggleMode(mode)}
              aria-pressed={isArmed}
              className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 min-h-[36px] ${
                isArmed
                  ? `${activeClass} ring-2 ring-offset-1 ring-${mode === 'tracking' ? 'blue' : mode === 'serial' ? 'emerald' : mode === 'fba' ? 'violet' : 'amber'}-400/50`
                  : isActive
                    ? activeClass
                    : 'bg-gray-100 text-gray-500'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}

        {isLoading && (
          <Loader2 className="h-4 w-4 animate-spin text-gray-400 ml-auto flex-shrink-0" />
        )}
      </div>

      {/* ── Scan input ── */}
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        <StationScanBar
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          inputRef={inputRef}
          inputBorderClassName={inputBorderClassName}
          placeholder="Scan or type…"
          autoFocus
          icon={scanBarIcon}
          inputClassName={`pl-[2.2rem] focus:ring-4 focus:ring-${themeColor}-500/10 focus:border-${themeColor}-500`}
          hasRightContent={false}
        />
      </motion.div>
    </div>
  );
}
