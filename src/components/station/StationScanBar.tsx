'use client';

import type { FormEvent, ReactNode, Ref } from 'react';
import { Barcode } from '../Icons';

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
}: StationScanBarProps) {
  const padLeft = leadingIcon ? 'pl-11' : 'pl-4';
  const padRight = hasRightContent ? 'pr-28' : 'pr-4';

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
        {hasRightContent ? (
          <div className={`absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 ${rightContentClassName}`.trim()}>
            {rightContent}
          </div>
        ) : null}
      </div>
    </form>
  );
}
