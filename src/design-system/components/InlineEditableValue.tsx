'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pencil } from '@/components/Icons';

type InlineTone = 'neutral' | 'blue' | 'orange' | 'red' | 'green' | 'purple' | 'yellow';

const focusToneClassName: Record<InlineTone, string> = {
  neutral: 'border-gray-400',
  blue: 'border-blue-500',
  orange: 'border-orange-500',
  red: 'border-red-500',
  green: 'border-green-500',
  purple: 'border-purple-500',
  yellow: 'border-yellow-500',
};

interface InlineEditableValueProps {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onSubmit?: () => void;
  editable?: boolean;
  className?: string;
  valueClassName?: string;
  inputClassName?: string;
  monospace?: boolean;
  tone?: InlineTone;
  autoFocus?: boolean;
  accessory?: ReactNode;
  showEditIcon?: boolean;
}

export function InlineEditableValue({
  value,
  placeholder = 'N/A',
  onChange,
  onBlur,
  onSubmit,
  editable = true,
  className = '',
  valueClassName = '',
  inputClassName = '',
  monospace = false,
  tone = 'neutral',
  autoFocus = false,
  accessory,
  showEditIcon = true,
}: InlineEditableValueProps) {
  const [isEditing, setIsEditing] = useState(autoFocus);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isEditing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditing]);

  const displayValue = String(value || '').trim();

  if (!editable) {
    return (
      <p className={`text-[13px] font-bold text-gray-900 ${monospace ? 'font-mono' : ''} ${valueClassName}`.trim()}>
        {displayValue || placeholder}
      </p>
    );
  }

  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`.trim()}>
      <div className="min-w-0 flex-1">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onBlur={() => {
              setIsEditing(false);
              onBlur?.();
              onSubmit?.();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
              if (event.key === 'Escape') {
                setIsEditing(false);
              }
            }}
            className={[
              'h-7 w-full border-0 border-b-2 bg-transparent px-0 pb-0.5 pt-0 text-[13px] font-bold text-gray-900 outline-none',
              monospace ? 'font-mono' : '',
              focusToneClassName[tone],
              inputClassName,
            ].join(' ').trim()}
            placeholder={placeholder}
          />
        ) : (
          <button type="button" onClick={() => setIsEditing(true)} className="block w-full py-0 text-left">
            <span
              className={`block truncate text-[13px] font-bold text-gray-900 ${monospace ? 'font-mono' : ''} ${valueClassName}`.trim()}
            >
              {displayValue || placeholder}
            </span>
          </button>
        )}
      </div>
      {accessory}
      {showEditIcon ? (
        <button
          type="button"
          onClick={() => setIsEditing((prev) => !prev)}
          className="text-gray-500 transition-colors duration-100 ease-out hover:text-gray-900 active:scale-95"
          aria-label="Edit value"
          title="Edit"
        >
          <Pencil className="h-[14px] w-[14px]" />
        </button>
      ) : null}
    </div>
  );
}
