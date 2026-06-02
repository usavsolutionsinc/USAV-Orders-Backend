'use client';

import { useCallback, useState, type FormEvent, type ReactNode, type Ref } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Barcode, Clipboard, ClipboardList, Pencil } from '../Icons';

interface StationScanBarProps {
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
}

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
}: StationScanBarProps) {
  const [scanKey, setScanKey] = useState(0);

  const handleInternalSubmit = useCallback((e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    // Trigger the sweep animation by updating the key
    setScanKey(prev => prev + 1);
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
  const showRight = hasRightContent || showPaste || modeButtonCount > 0;

  const padLeft = leadingIcon ? 'pl-11' : 'pl-4';
  const padRight = showRight ? (modeButtonCount >= 2 ? 'pr-40' : 'pr-28') : 'pr-4';

  return (
    <motion.form
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ 
        type: 'spring', 
        damping: 25, 
        stiffness: 120,
        opacity: { duration: 0.2 }
      }}
      onSubmit={handleInternalSubmit} 
      className={`relative group ${className}`.trim()}
    >
      <div className="relative overflow-hidden rounded-xl">
        {/* Scan Sweep Animation */}
        <AnimatePresence>
          {scanKey > 0 && (
            <motion.div
              key={scanKey}
              initial={{ x: '-20%', opacity: 0, scaleX: 0.5 }}
              animate={{ 
                x: '130%', 
                opacity: [0, 1, 1, 0],
                scaleX: [0.8, 1, 1, 0.8]
              }}
              exit={{ opacity: 0 }}
              transition={{ 
                duration: 0.45, 
                ease: [0.22, 1, 0.36, 1] 
              }}
              className="absolute inset-y-0 w-48 pointer-events-none z-20"
              style={{
                background: 'linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.4), rgba(168, 85, 247, 0.5), rgba(59, 130, 246, 0.4), transparent)',
                skewX: '-25deg',
                filter: 'blur(8px)',
              }}
            />
          )}
        </AnimatePresence>

        {leadingIcon ? (
          <div className={`absolute left-4 top-1/2 -translate-y-1/2 z-10 ${iconClassName}`}>
            {icon ?? <Barcode className="h-4 w-4" />}
          </div>
        ) : null}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onInputBlur}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          className={[
            'w-full bg-gray-50 rounded-xl text-xs font-bold outline-none transition-all shadow-inner py-1.5',
            padLeft,
            padRight,
            inputBorderClassName ?? 'border border-gray-100',
            inputClassName,
          ].join(' ').trim()}
        />
        {showRight ? (
          <div className={`absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 z-10 ${rightContentClassName}`.trim()}>
            {modeButtonCount > 0 ? (
              <div className="flex items-center gap-0">
                {visibleModes.includes('plan') ? (
                  <button
                    type="button"
                    onClick={onPlanMode}
                    aria-pressed={activeMode === 'plan'}
                    title="Plan mode"
                    aria-label={activeMode === 'plan' ? 'Plan mode active' : 'Switch to plan mode'}
                    className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/60 ${
                      activeMode === 'plan'
                        ? 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
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
                    className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/60 ${
                      activeMode === 'select'
                        ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
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
