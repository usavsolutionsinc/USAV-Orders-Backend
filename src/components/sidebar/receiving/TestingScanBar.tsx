'use client';

import { useRef, type FormEvent } from 'react';
import { Loader2, Barcode, MapPin, ClipboardList } from '@/components/Icons';
import { StationScanBar } from '@/components/station/StationScanBar';
import { useStationTheme } from '@/hooks/useStationTheme';
import type { ForcedTestingType } from '@/lib/testing/resolve-testing-scan';

export interface TestingScanModeMeta {
  mode: ForcedTestingType;
  label: string;
  Icon: typeof MapPin;
  /** Classes for the armed (active) mode button. */
  armedClass: string;
  /** Tint for the icon when this mode is the active left indicator. */
  iconClass: string;
}

/**
 * The three explicit search routes the testing scan bar can be armed to —
 * mirrors the shipping station's mode buttons (icon + tint per type). When a
 * mode is armed, the next Enter/scan is forced to that type instead of
 * auto-detecting.
 */
export const TESTING_SCAN_MODES: readonly TestingScanModeMeta[] = [
  {
    mode: 'tracking',
    label: 'Tracking',
    Icon: MapPin,
    armedClass: 'text-blue-700 bg-blue-50',
    iconClass: 'text-blue-600',
  },
  {
    mode: 'po',
    label: 'PO#',
    Icon: ClipboardList,
    armedClass: 'text-indigo-700 bg-indigo-50',
    iconClass: 'text-indigo-600',
  },
  {
    mode: 'serial',
    label: 'Serial',
    Icon: Barcode,
    armedClass: 'text-emerald-700 bg-emerald-50',
    iconClass: 'text-emerald-600',
  },
] as const;

export function testingScanModeMeta(mode: ForcedTestingType): TestingScanModeMeta {
  return TESTING_SCAN_MODES.find((m) => m.mode === mode) ?? TESTING_SCAN_MODES[2];
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  isResolving?: boolean;
  /** Staff id used to theme the input border (matches the shipping bar's tint). */
  staffId?: string;
  /** Currently armed search route, or null for auto-detect. */
  armedMode?: ForcedTestingType | null;
  /** Toggle a search route on/off. */
  onToggleMode?: (mode: ForcedTestingType) => void;
}

const MODE_BTN = 'flex h-7 w-7 items-center justify-center rounded-md transition-colors';
const MODE_BTN_INACTIVE = 'text-gray-400 hover:text-gray-600 hover:bg-gray-100';

/**
 * Testing scan bar. Same chrome as the shipping {@link StationScanBar} — and
 * now the same explicit mode toggles: tap Tracking / PO# / Serial to force the
 * next scan's search type. With no mode armed it auto-detects. The left icon
 * reflects the armed route so the operator always sees what the next scan will
 * be treated as.
 */
export function TestingScanBar({
  value,
  onChange,
  onSubmit,
  isResolving = false,
  staffId,
  armedMode = null,
  onToggleMode,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { theme: themeColor, inputBorder } = useStationTheme({
    staffId: staffId ? Number(staffId) : 0,
  });

  const handleSubmit = (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    onSubmit();
  };

  const active = armedMode ? testingScanModeMeta(armedMode) : null;
  const ActiveIcon = active?.Icon ?? Barcode;

  return (
    <div data-testing-scan>
      <StationScanBar
        value={value}
        onChange={onChange}
        onSubmit={handleSubmit}
        inputRef={inputRef}
        inputBorderClassName={inputBorder}
        placeholder={
          armedMode ? `Scan ${active?.label}…` : 'Scan or pick a route → Tracking · PO# · Serial'
        }
        autoFocus
        icon={
          <span
            className={`-ml-1 flex items-center justify-center ${active?.iconClass ?? 'text-gray-400'}`}
            role="status"
            aria-label={armedMode ? `Armed: ${active?.label}` : 'Auto-detect'}
            title={armedMode ? `Next scan forced to ${active?.label}` : 'Auto-detect (pick a route to force)'}
          >
            <ActiveIcon className="h-[17px] w-[17px] transition-colors" />
          </span>
        }
        inputClassName={`pl-[2.2rem] focus:ring-4 focus:ring-${themeColor}-500/10 focus:border-${themeColor}-500 pr-28`}
        rightContentClassName="right-1.5 gap-0.5"
        rightContent={
          <>
            {isResolving && <Loader2 className="h-4 w-4 animate-spin text-gray-700" />}
            <div className="flex items-center gap-0">
              {TESTING_SCAN_MODES.map(({ mode, label, Icon, armedClass }) => {
                const armed = armedMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onToggleMode?.(mode)}
                    aria-pressed={armed}
                    aria-label={
                      armed
                        ? `${label} armed for next scan. Click again to cancel.`
                        : `Arm ${label}: next Enter/scan searches ${label}. If the field has text, search now.`
                    }
                    title={
                      armed
                        ? `${label} armed — next Enter/scan. Click again to cancel.`
                        : `Arm ${label} (next Enter/scan; or search now if the field has text)`
                    }
                    className={`${MODE_BTN} ${armed ? armedClass : MODE_BTN_INACTIVE}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                );
              })}
            </div>
          </>
        }
      />
    </div>
  );
}
