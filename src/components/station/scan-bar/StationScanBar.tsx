'use client';

import {
  useCallback,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { motionBezier } from '@/design-system/foundations/motion-framer';
import { Barcode, Clipboard, ClipboardList, Pencil } from '@/components/Icons';
import { ScanHotkeyControl } from '@/components/scan/ScanHotkeyControl';
import { useRegisterScanTarget } from '@/lib/scan-hotkey/useScanHotkey';
import {
  STATION_SCAN_BAR_MODE_BTN_ARMED,
  STATION_SCAN_BAR_DEFAULT_ICON_CLASS,
  STATION_SCAN_BAR_ICON_SLOT_CLASS,
  STATION_SCAN_BAR_INPUT_CLASS,
  STATION_SCAN_BAR_PAD_LEFT_CLASS,
  STATION_SCAN_BAR_PAD_LEFT_NONE_ICON_CLASS,
  STATION_SCAN_BAR_RIGHT_SLOT_CLASS,
} from './tokens';

export interface StationScanBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void;
  inputRef?: Ref<HTMLInputElement>;
  placeholder?: string;
  autoFocus?: boolean;
  icon?: ReactNode;
  iconClassName?: string;
  rightContent?: ReactNode;
  className?: string;
  inputClassName?: string;
  rightContentClassName?: string;
  hasRightContent?: boolean;
  /** Replaces the default `border border-gray-100` on the `<input>` (e.g. theme stroke from staff-colors). */
  inputBorderClassName?: string;
  /** Omit left icon slot and use horizontal padding (e.g. labeled fields in FBA sidebar). */
  leadingIcon?: boolean;
  onInputBlur?: () => void;
  disabled?: boolean;
  /** Show clipboard paste button when input is empty — calls onChange with clipboard text. */
  onPaste?: (text: string) => void;
  /** Optional built-in mode toggle buttons (Plan / Select). */
  showModeButtons?: boolean;
  activeMode?: 'plan' | 'select';
  onPlanMode?: () => void;
  onSelectMode?: () => void;
  /** Which mode buttons to render — defaults to both. Pass a single mode to
   *  pin the bar to one page (Plan-only on the plan page, Select-only on combine). */
  visibleModes?: Array<'plan' | 'select'>;
  /**
   * Wire the shared focus-scan hotkey: registers this bar as the global key's
   * focus target and reveals the gear (reassign) affordance in the left icon
   * slot on hover. Default true — every primary scan bar gets it for free.
   * Set false for secondary/inline fields that shouldn't steal the hotkey.
   * Only renders the gear when `leadingIcon` is true (needs the icon slot).
   */
  hotkey?: boolean;
}

/** Assign a node to both an internal object ref and a forwarded ref of any shape. */
function assignRef<T>(node: T, forwarded: Ref<T> | undefined): void {
  if (!forwarded) return;
  if (typeof forwarded === 'function') forwarded(node);
  else (forwarded as unknown as { current: T | null }).current = node;
}

/**
 * Core scan input — icon slot, hotkey gear, sweep animation, optional right
 * rail. For themed station chrome prefer {@link ThemedStationScanBar}; change
 * padding/height via {@link ./tokens.ts}.
 */
export function StationScanBar({
  value,
  onChange,
  onSubmit,
  inputRef,
  placeholder = 'Tracking, FNSKU, RS ID, SN',
  autoFocus = false,
  icon,
  iconClassName = 'text-gray-700',
  rightContent,
  className = '',
  inputClassName = '',
  rightContentClassName = '',
  hasRightContent = true,
  inputBorderClassName,
  leadingIcon = true,
  onInputBlur,
  disabled = false,
  onPaste,
  showModeButtons = false,
  activeMode = 'plan',
  onPlanMode,
  onSelectMode,
  visibleModes = ['plan', 'select'],
  hotkey = true,
}: StationScanBarProps) {
  const [scanKey, setScanKey] = useState(0);

  const internalInputRef = useRef<HTMLInputElement | null>(null);
  const setInputRef = useCallback(
    (node: HTMLInputElement | null) => {
      internalInputRef.current = node;
      assignRef(node, inputRef);
    },
    [inputRef],
  );
  const showHotkeyGear = hotkey && leadingIcon;
  useRegisterScanTarget(internalInputRef, showHotkeyGear);

  const handleInternalSubmit = useCallback((e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    setScanKey((prev) => prev + 1);
    onSubmit(e);
  }, [onSubmit]);

  const handlePasteClick = useCallback(async () => {
    if (!onPaste) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) onPaste(text.trim());
    } catch { /* clipboard blocked */ }
  }, [onPaste]);

  const showPaste = !!onPaste;
  const modeButtonCount = showModeButtons ? visibleModes.length : 0;
  const hasActiveRightContent = hasRightContent && rightContent != null;
  const showRight = hasActiveRightContent || showPaste || modeButtonCount > 0;

  const padLeft = leadingIcon ? STATION_SCAN_BAR_PAD_LEFT_CLASS : STATION_SCAN_BAR_PAD_LEFT_NONE_ICON_CLASS;
  const padRight = showRight ? (modeButtonCount >= 2 ? 'pr-40' : 'pr-28') : 'pr-4';

  return (
    <motion.form
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        type: 'spring',
        damping: 25,
        stiffness: 120,
        opacity: { duration: 0.2 },
      }}
      onSubmit={handleInternalSubmit}
      className={`relative group ${className}`.trim()}
    >
      <div className="relative isolate rounded-xl">
        <div className="pointer-events-none absolute inset-0 z-raised overflow-hidden rounded-xl">
          <AnimatePresence>
            {scanKey > 0 && (
              <motion.div
                key={scanKey}
                initial={{ x: '-20%', opacity: 0, scaleX: 0.5 }}
                animate={{
                  x: '130%',
                  opacity: [0, 1, 1, 0],
                  scaleX: [0.8, 1, 1, 0.8],
                }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: 0.45,
                  ease: motionBezier.easeOut,
                }}
                className="absolute inset-y-0 w-48"
                style={{
                  background:
                    'linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.4), rgba(168, 85, 247, 0.5), rgba(59, 130, 246, 0.4), transparent)',
                  skewX: '-25deg',
                  filter: 'blur(8px)',
                }}
              />
            )}
          </AnimatePresence>
        </div>

        {leadingIcon ? (
          <div className={`${STATION_SCAN_BAR_ICON_SLOT_CLASS} ${iconClassName}`}>
            {showHotkeyGear ? (
              <ScanHotkeyControl>{icon ?? <Barcode className={STATION_SCAN_BAR_DEFAULT_ICON_CLASS} />}</ScanHotkeyControl>
            ) : (
              icon ?? <Barcode className={STATION_SCAN_BAR_DEFAULT_ICON_CLASS} />
            )}
          </div>
        ) : null}
        <input
          ref={setInputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onInputBlur}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          className={[
            STATION_SCAN_BAR_INPUT_CLASS,
            'relative z-base',
            padLeft,
            padRight,
            // On hover the hotkey chip slides in from the left; shift the
            // placeholder/value right (rather than hiding it) so the gear + key
            // have room. `transition-all` on the input animates the pad change.
            showHotkeyGear ? 'group-hover:pl-16' : '',
            inputBorderClassName ?? 'border border-gray-100',
            inputClassName,
          ].join(' ').trim()}
        />
        {showRight ? (
          <div className={`${STATION_SCAN_BAR_RIGHT_SLOT_CLASS} ${rightContentClassName}`.trim()}>
            {modeButtonCount > 0 ? (
              <div className="flex items-center gap-0">
                {visibleModes.includes('plan') ? (
                  <button
                    type="button"
                    onClick={onPlanMode}
                    aria-pressed={activeMode === 'plan'}
                    title="Plan mode"
                    aria-label={activeMode === 'plan' ? 'Plan mode active' : 'Switch to plan mode'}
                    className={`relative flex h-6 w-6 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/60 ${
                      activeMode === 'plan'
                        ? `${STATION_SCAN_BAR_MODE_BTN_ARMED} bg-purple-50 text-purple-700 hover:bg-purple-100`
                        : 'z-base text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                    }`}
                  >
                    <ClipboardList className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                {visibleModes.includes('select') ? (
                  <button
                    type="button"
                    onClick={onSelectMode}
                    aria-pressed={activeMode === 'select'}
                    title="Select mode"
                    aria-label={activeMode === 'select' ? 'Select mode active' : 'Switch to select mode'}
                    className={`relative flex h-6 w-6 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/60 ${
                      activeMode === 'select'
                        ? `${STATION_SCAN_BAR_MODE_BTN_ARMED} bg-blue-50 text-blue-700 hover:bg-blue-100`
                        : 'z-base text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                    }`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ) : null}
            {hasRightContent && rightContent}
            {showPaste && (
              <button
                type="button"
                onClick={() => void handlePasteClick()}
                className="flex h-6 w-6 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/60"
                title="Paste from clipboard"
                aria-label="Paste from clipboard"
              >
                <Clipboard className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ) : null}
      </div>
    </motion.form>
  );
}
