'use client';

import type { ComponentType, SVGProps } from 'react';
import { cn } from '@/utils/_cn';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import {
  STATION_SCAN_BAR_MODE_BTN,
  STATION_SCAN_BAR_MODE_BTN_ARMED,
  STATION_SCAN_BAR_MODE_BTN_COMPACT,
  STATION_SCAN_BAR_MODE_BTN_INACTIVE,
} from './tokens';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export interface StationScanModeDefinition<T extends string> {
  mode: T;
  label: string;
  Icon: IconComponent;
  armedClass: string;
}

interface StationScanModeRailProps<T extends string> {
  modes: readonly StationScanModeDefinition<T>[];
  armedMode: T | null;
  onToggleMode?: (mode: T) => void;
  size?: 'default' | 'compact';
  getAriaLabel?: (mode: StationScanModeDefinition<T>, armed: boolean) => string;
  getTitle?: (mode: StationScanModeDefinition<T>, armed: boolean) => string;
}

const BTN_BY_SIZE = {
  default: STATION_SCAN_BAR_MODE_BTN,
  compact: STATION_SCAN_BAR_MODE_BTN_COMPACT,
} as const;

/**
 * Shared right-rail mode toggles (Tracking / PO# / Serial / …). Domain wrappers
 * supply the mode list + armed state; chrome stays identical everywhere.
 */
export function StationScanModeRail<T extends string>({
  modes,
  armedMode,
  onToggleMode,
  size = 'default',
  getAriaLabel,
  getTitle,
}: StationScanModeRailProps<T>) {
  const btnShell = BTN_BY_SIZE[size];

  return (
    <div className="relative z-dropdown isolate flex items-center gap-0">
      {modes.map((mode) => {
        const armed = armedMode === mode.mode;
        const ariaLabel =
          getAriaLabel?.(mode, armed) ??
          (armed
            ? `${mode.label} armed for next scan. Click again to cancel.`
            : `Arm ${mode.label}: next Enter/scan searches ${mode.label}.`);
        const title =
          getTitle?.(mode, armed) ??
          (armed
            ? `${mode.label} armed — next Enter/scan. Click again to cancel.`
            : `${mode.label} (next Enter/scan; or search now if the field has text)`);

        return (
          <HoverTooltip key={mode.mode} label={title} asChild>
            {/* ds-raw-button: scan-station segmented mode pill (armed/inactive toggle via STATION_SCAN_BAR_MODE_* tokens) — intentionally not a Button/IconButton primitive */}
            <button
              type="button"
              onClick={() => onToggleMode?.(mode.mode)}
              aria-pressed={armed}
              aria-label={ariaLabel}
              className={cn(
                'ds-raw-button',
                btnShell,
                armed
                  ? cn(STATION_SCAN_BAR_MODE_BTN_ARMED, mode.armedClass)
                  : STATION_SCAN_BAR_MODE_BTN_INACTIVE,
              )}
            >
              <mode.Icon className="h-3.5 w-3.5" />
            </button>
          </HoverTooltip>
        );
      })}
    </div>
  );
}
