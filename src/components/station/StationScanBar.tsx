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
}: StationScanBarProps) {
  return (
    <form onSubmit={onSubmit} className={`relative group ${className}`.trim()}>
      <div className={`absolute left-4 top-1/2 -translate-y-1/2 ${iconClassName}`}>
        {icon || <Barcode className="w-4 h-4" />}
      </div>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={[
          'w-full bg-gray-50 border border-gray-100 rounded-2xl text-xs font-bold outline-none transition-all shadow-inner py-3.5 pl-11',
          hasRightContent ? 'pr-28' : 'pr-4',
          inputClassName,
        ].join(' ').trim()}
      />
      {hasRightContent ? (
        <div className={`absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 ${rightContentClassName}`.trim()}>
          {rightContent}
        </div>
      ) : null}
    </form>
  );
}
