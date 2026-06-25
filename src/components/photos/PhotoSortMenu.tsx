'use client';

import { useRef, useState } from 'react';
import { AnchoredLayer } from '@/design-system';
import { ArrowUpDown, Check } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import type { PhotoLibrarySortMode } from '@/lib/photos/library-filter-state';

const OPTIONS: { value: PhotoLibrarySortMode; label: string }[] = [
  { value: 'recent', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
];

/** Right-pane "Sort by" control (the brief: sort lives in the main panel, not the sidebar). */
export function PhotoSortMenu({
  sort,
  onSortChange,
}: {
  sort: PhotoLibrarySortMode;
  onSortChange: (s: PhotoLibrarySortMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = OPTIONS.find((o) => o.value === sort) ?? OPTIONS[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Sort photos"
        aria-label="Sort photos"
        className="flex h-7 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 text-micro font-bold text-gray-600 transition-colors hover:bg-gray-50"
      >
        <ArrowUpDown className="h-3.5 w-3.5 text-gray-400" />
        <span className="hidden sm:inline">{current.label}</span>
      </button>

      <AnchoredLayer open={open} onClose={() => setOpen(false)} anchorRef={ref} placement="bottom-end" gap={4}>
        <div className="w-44 rounded-lg border border-gray-200 bg-white p-1 shadow-xl">
          <p className="px-2 pb-1 pt-1.5 text-[9px] font-black uppercase tracking-widest text-gray-400">Sort by</p>
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onSortChange(o.value);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12px] font-semibold transition hover:bg-gray-50',
                o.value === sort ? 'text-blue-700' : 'text-gray-700',
              )}
            >
              {o.label}
              {o.value === sort ? <Check className="h-3.5 w-3.5" /> : null}
            </button>
          ))}
        </div>
      </AnchoredLayer>
    </div>
  );
}
