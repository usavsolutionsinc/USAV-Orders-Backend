'use client';

import { useCallback, type FormEvent, type ReactNode, type Ref } from 'react';
import { Barcode, Clipboard } from '../Icons';

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
}: StationScanBarProps) {
  const handlePasteClick = useCallback(async () => {
    if (!onPaste) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) onPaste(text.trim());
    } catch { /* clipboard blocked */ }
  }, [onPaste]);

  const showPaste = !!onPaste && !value.trim();
  const showRight = hasRightContent || showPaste;

  const padLeft = leadingIcon ? 'pl-11' : 'pl-4';
  const padRight = showRight ? 'pr-28' : 'pr-4';

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
