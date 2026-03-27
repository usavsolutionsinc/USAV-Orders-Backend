'use client';

import { useCallback, type FormEvent, type ReactNode, type Ref } from 'react';
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
}: StationScanBarProps) {
  const handlePasteClick = useCallback(async () => {
    if (!onPaste) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) onPaste(text.trim());
    } catch { /* clipboard blocked */ }
  }, [onPaste]);

  const showPaste = !!onPaste;
  const showRight = hasRightContent || showPaste || showModeButtons;

  const padLeft = leadingIcon ? 'pl-11' : 'pl-4';
  const padRight = showRight ? (showModeButtons ? 'pr-40' : 'pr-28') : 'pr-4';

  return (
    <form onSubmit={onSubmit} className={`relative group ${className}`.trim()}>
      <div className="relative">
        {leadingIcon ? (
          <div className={`absolute left-4 top-1/2 -translate-y-1/2 ${iconClassName}`}>
            {icon ?? <Barcode className="w-4 h-4" />}
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
            'w-full bg-gray-50 rounded-2xl text-xs font-bold outline-none transition-all shadow-inner py-3.5',
            padLeft,
            padRight,
            inputBorderClassName ?? 'border border-gray-100',
            inputClassName,
          ].join(' ').trim()}
        />
        {showRight ? (
          <div className={`absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 ${rightContentClassName}`.trim()}>
            {showModeButtons ? (
              <div className="flex items-center gap-0">
                <button
                  type="button"
                  onClick={onPlanMode}
                  aria-pressed={activeMode === 'plan'}
                  title="Plan mode"
                  aria-label={activeMode === 'plan' ? 'Plan mode active' : 'Switch to plan mode'}
                  className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/60 ${
                    activeMode === 'plan'
                      ? 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                      : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
                  }`}
                >
                  <ClipboardList className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={onSelectMode}
                  aria-pressed={activeMode === 'select'}
                  title="Select mode"
                  aria-label={activeMode === 'select' ? 'Select mode active' : 'Switch to select mode'}
                  className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/60 ${
                    activeMode === 'select'
                      ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                      : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
                  }`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
            {hasRightContent && rightContent}
            {showPaste && (
              <button
                type="button"
                onClick={() => void handlePasteClick()}
                className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/60"
                title="Paste from clipboard"
                aria-label="Paste from clipboard"
              >
                <Clipboard className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ) : null}
      </div>
    </form>
  );
}
