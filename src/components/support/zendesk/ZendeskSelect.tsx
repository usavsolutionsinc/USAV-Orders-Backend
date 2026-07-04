'use client';

import { useRef, useState } from 'react';
import { AnchoredLayer } from '@/design-system';
import { cn } from '@/utils/_cn';

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
  /** `field` matches form inputs (h-10, rounded-xl); `compact` is the queue/header chip. */
  size?: 'compact' | 'field';
  className?: string;
}

/** Small headless dropdown used for the status / priority / assignee pickers. */
export function ZendeskSelect({
  value,
  options,
  onChange,
  disabled,
  placeholder = 'Select',
  align = 'left',
  size = 'compact',
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value) ?? null;
  const isField = size === 'field';

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'ds-raw-button flex w-full items-center justify-between gap-2 border border-border-default bg-surface-card text-text-default transition-colors hover:bg-surface-hover disabled:opacity-50',
          isField
            ? 'h-10 min-h-10 rounded-xl px-3 text-[13px] font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100'
            : 'inline-flex max-w-[180px] gap-1.5 rounded-lg px-2.5 py-1.5 text-caption font-bold',
        )}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <svg
          className={`h-3 w-3 shrink-0 text-text-soft transition-transform ${open ? 'rotate-180' : ''}`}
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
        <div className="max-h-64 w-max min-w-[150px] overflow-auto rounded-lg border border-border-soft bg-surface-card p-1 shadow-xl">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`ds-raw-button flex w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left hover:bg-surface-hover ${
                o.value === value ? 'bg-surface-canvas' : ''
              }`}
            >
              <span className="text-caption font-bold text-text-default">{o.label}</span>
              {o.sublabel ? <span className="text-micro text-text-soft">{o.sublabel}</span> : null}
            </button>
          ))}
        </div>
      </AnchoredLayer>
    </div>
  );
}
