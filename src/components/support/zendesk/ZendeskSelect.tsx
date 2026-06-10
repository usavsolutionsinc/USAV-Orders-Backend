'use client';

import { useRef, useState } from 'react';
import { AnchoredLayer } from '@/design-system';

export interface SelectOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface Props {
  value: string | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  align?: 'left' | 'right';
}

/** Small headless dropdown used for the status / priority / assignee pickers. */
export function ZendeskSelect({
  value,
  options,
  onChange,
  disabled,
  placeholder = 'Select',
  align = 'left',
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value) ?? null;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex max-w-[180px] items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-caption font-bold text-gray-800 transition-colors hover:bg-gray-50 disabled:opacity-50"
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <svg
          className={`h-3 w-3 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <AnchoredLayer
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={wrapperRef}
        placement={align === 'right' ? 'bottom-end' : 'bottom-start'}
        gap={4}
      >
        <div className="max-h-64 w-max min-w-[150px] overflow-auto rounded-lg border border-gray-200 bg-white p-1 shadow-xl">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`flex w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left hover:bg-gray-50 ${
                o.value === value ? 'bg-gray-50' : ''
              }`}
            >
              <span className="text-caption font-bold text-gray-800">{o.label}</span>
              {o.sublabel ? <span className="text-micro text-gray-500">{o.sublabel}</span> : null}
            </button>
          ))}
        </div>
      </AnchoredLayer>
    </div>
  );
}
