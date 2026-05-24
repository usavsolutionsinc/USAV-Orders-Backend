'use client';

import { useCallback, useRef, type WheelEvent } from 'react';
import { CONDITION_OPTS } from '@/components/station/receiving-constants';

interface Props {
  value: string | null | undefined;
  onChange: (next: string) => void;
}

// Per-grade visual tone — selected = filled, unselected = soft outline.
// Yellow for new (factory-fresh), green for top used, blue for solid used,
// slate for cosmetic-only, amber for parts-only — deliberate hierarchy by tone.
const TONE: Record<string, { active: string; inactive: string }> = {
  BRAND_NEW: {
    active: 'bg-yellow-500 text-white shadow-sm shadow-yellow-200 ring-yellow-600',
    inactive: 'bg-white text-yellow-800 ring-yellow-200 hover:bg-yellow-50',
  },
  USED_A: {
    active: 'bg-emerald-600 text-white shadow-sm shadow-emerald-200 ring-emerald-700',
    inactive: 'bg-white text-emerald-800 ring-emerald-200 hover:bg-emerald-50',
  },
  USED_B: {
    active: 'bg-blue-600 text-white shadow-sm shadow-blue-200 ring-blue-700',
    inactive: 'bg-white text-blue-800 ring-blue-200 hover:bg-blue-50',
  },
  USED_C: {
    active: 'bg-slate-700 text-white shadow-sm shadow-slate-300 ring-slate-800',
    inactive: 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50',
  },
  PARTS: {
    active: 'bg-amber-700 text-white shadow-sm shadow-amber-200 ring-amber-800',
    inactive: 'bg-white text-amber-800 ring-amber-200 hover:bg-amber-50',
  },
};

/**
 * Bare, mobile-first condition picker. Renders the 5 grades as a single
 * horizontally-scrolling row of ring-bordered pills. No card wrapper, no
 * internal header — callers own the label and surrounding layout.
 *
 * Used by every interactive condition picker in the app so the colour
 * vocabulary (yellow=new, green=A, blue=B, slate=C, amber=parts) stays
 * consistent across the receiving workspace, label printer, shipped
 * details panel, and intake forms.
 */
export function ConditionPills({ value, onChange }: Props) {
  const selected = String(value || '').trim().toUpperCase();
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Translate vertical wheel input to horizontal scroll while the pointer
  // is over the row — mouse users on desktop have no other way to reach
  // overflowed pills without a visible scrollbar.
  const onWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    if (!el) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  }, []);

  return (
    <div
      ref={scrollerRef}
      onWheel={onWheel}
      role="radiogroup"
      aria-label="Condition grade"
      className="-mx-1 flex gap-1.5 overflow-x-auto overscroll-x-contain px-1 py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
      {CONDITION_OPTS.map((opt) => {
        const isActive = selected === opt.value;
        const tone = TONE[opt.value] ?? TONE.USED_C;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(opt.value)}
            className={`inline-flex h-9 shrink-0 snap-start items-center whitespace-nowrap rounded-full px-4 text-caption font-black uppercase tracking-[0.1em] ring-1 ring-inset transition-all active:scale-[0.98] ${
              isActive ? tone.active : tone.inactive
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
