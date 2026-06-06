'use client';

import { useRef, type FormEvent, type Ref } from 'react';
import { Loader2, MapPin, Hash } from '@/components/Icons';
import { StationScanBar } from '@/components/station/StationScanBar';
import { useStationTheme } from '@/hooks/useStationTheme';

/** The two explicit search routes the unbox scan bar can be armed to. */
export type UnboxScanMode = 'tracking' | 'order';

interface UnboxScanModeMeta {
  mode: UnboxScanMode;
  label: string;
  Icon: typeof MapPin;
  /** Classes for the armed (active) mode button. */
  armedClass: string;
  /** Tint for the left icon when this mode is the effective route. */
  iconClass: string;
}

export const UNBOX_SCAN_MODES: readonly UnboxScanModeMeta[] = [
  {
    mode: 'tracking',
    label: 'Tracking #',
    Icon: MapPin,
    armedClass: 'text-blue-700 bg-blue-50',
    iconClass: 'text-blue-600',
  },
  {
    // Gray to match the PO#/order chips in CopyChip (PoChip / OrderIdChip).
    mode: 'order',
    label: 'PO #',
    Icon: Hash,
    armedClass: 'text-gray-700 bg-gray-100',
    iconClass: 'text-gray-500',
  },
] as const;

function modeMeta(mode: UnboxScanMode): UnboxScanModeMeta {
  return UNBOX_SCAN_MODES.find((m) => m.mode === mode) ?? UNBOX_SCAN_MODES[0];
}

/**
 * Auto-classify a scanned value when no mode is armed: anything containing a
 * dash is an order / PO reference number (Amazon "111-2222222-3333333", Zoho
 * "PO-00123"), everything else is a carrier tracking number. An armed mode
 * always wins over this heuristic.
 */
export function classifyUnboxScan(value: string): UnboxScanMode {
  return value.includes('-') ? 'order' : 'tracking';
}

const MODE_BTN = 'flex h-6 w-6 items-center justify-center rounded-md transition-colors';
const MODE_BTN_INACTIVE = 'text-gray-400 hover:text-gray-600 hover:bg-gray-100';

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** Fired on Enter/scan with the resolved mode (armed mode, else auto-classified). */
  onSubmit: (mode: UnboxScanMode) => void;
  inputRef?: Ref<HTMLInputElement>;
  isResolving?: boolean;
  staffId?: string;
  /** Currently armed search route, or null for auto-detect (dash → order). */
  armedMode?: UnboxScanMode | null;
  /** Toggle a search route on/off. */
  onToggleMode?: (mode: UnboxScanMode) => void;
}

/**
 * Unbox scan bar. Same chrome as {@link StationScanBar}, with explicit
 * Tracking / Order# mode toggles mirroring the testing station. With no mode
 * armed it auto-detects (a value with a dash → Order#). The left icon reflects
 * the effective route so the operator always sees how the next scan resolves.
 */
export function ReceivingUnboxScanBar({
  value,
  onChange,
  onSubmit,
  inputRef,
  isResolving = false,
  staffId,
  armedMode = null,
  onToggleMode,
}: Props) {
  const fallbackRef = useRef<HTMLInputElement>(null);
  const { theme: themeColor, inputBorder } = useStationTheme({
    staffId: staffId ? Number(staffId) : 0,
  });

  // Effective route drives the left icon + placeholder: armed wins, else the
  // dash heuristic on whatever is typed so far.
  const effective: UnboxScanMode = armedMode ?? classifyUnboxScan(value);
  const active = modeMeta(effective);
  const ActiveIcon = active.Icon;

  const handleSubmit = (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    onSubmit(armedMode ?? classifyUnboxScan(value));
  };

  return (
    <StationScanBar
      value={value}
      onChange={onChange}
      onSubmit={handleSubmit}
      inputRef={inputRef ?? fallbackRef}
      inputBorderClassName={inputBorder}
      placeholder={armedMode ? `Scan ${active.label}` : 'Tracking, PO #'}
      autoFocus
      className="w-full"
      icon={
        <span
          className={`flex items-center justify-center ${active.iconClass}`}
          role="status"
          aria-label={armedMode ? `Armed: ${active.label}` : `Auto-detect (${active.label})`}
          title={
            armedMode
              ? `Next scan forced to ${active.label}. Click the icon again to auto-detect.`
              : `Auto-detect — a value with “-” searches PO #, otherwise Tracking`
          }
        >
          <ActiveIcon className="h-[17px] w-[17px] transition-colors" />
        </span>
      }
      inputClassName={`pl-[2.2rem] focus:ring-4 focus:ring-${themeColor}-500/10 focus:border-${themeColor}-500 pr-24`}
      rightContentClassName="right-1.5 gap-0.5"
      rightContent={
        <>
          {isResolving && <Loader2 className="h-4 w-4 animate-spin text-gray-700" />}
          <div className="flex items-center gap-0">
            {UNBOX_SCAN_MODES.map(({ mode, label, Icon, armedClass }) => {
              const armed = armedMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onToggleMode?.(mode)}
                  aria-pressed={armed}
                  aria-label={
                    armed
                      ? `${label} armed for next scan. Click again to auto-detect.`
                      : `Arm ${label}: force the next scan to search ${label}.`
                  }
                  title={
                    armed
                      ? `${label} armed — next scan. Click again to auto-detect.`
                      : `Search by ${label}`
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
  );
}
