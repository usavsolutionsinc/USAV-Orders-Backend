'use client';

import { useCallback, useRef, type RefObject, type WheelEvent } from 'react';
import { motion } from 'framer-motion';

export type HorizontalSliderTone = 'zinc' | 'yellow' | 'emerald' | 'red' | 'blue' | 'orange' | 'purple';

export type HorizontalSliderItem = {
  id: string;
  label: string;
  count?: number;
  /** Used when variant is `fba`. */
  tone?: HorizontalSliderTone;
};

const FBA_TONE: Record<
  HorizontalSliderTone,
  { activeBg: string; activeText: string; ring: string }
> = {
  zinc: { activeBg: 'bg-zinc-100', activeText: 'text-zinc-900', ring: 'ring-zinc-300' },
  yellow: { activeBg: 'bg-yellow-100', activeText: 'text-black', ring: 'ring-yellow-300' },
  emerald: { activeBg: 'bg-emerald-100', activeText: 'text-black', ring: 'ring-emerald-300' },
  red: { activeBg: 'bg-red-100', activeText: 'text-black', ring: 'ring-red-300' },
  blue: { activeBg: 'bg-blue-100', activeText: 'text-black', ring: 'ring-blue-300' },
  orange: { activeBg: 'bg-orange-100', activeText: 'text-black', ring: 'ring-orange-300' },
  purple: { activeBg: 'bg-purple-100', activeText: 'text-black', ring: 'ring-purple-300' },
};

/* ── Preset filter items (single source of truth for tones) ── */

export const SLIDER_PRESETS = {
  all:        { id: 'all',      label: 'All',       tone: 'blue'    } as HorizontalSliderItem,
  mustGo:     { id: 'must_go',  label: 'Must Go',   tone: 'red'     } as HorizontalSliderItem,
  newest:     { id: 'newest',   label: 'Newest',    tone: 'emerald' } as HorizontalSliderItem,
  oldest:     { id: 'oldest',   label: 'Oldest',    tone: 'zinc'    } as HorizontalSliderItem,
  amazon:     { id: 'amazon',   label: 'Amazon',    tone: 'orange'  } as HorizontalSliderItem,
  ebay:       { id: 'ebay',     label: 'eBay',      tone: 'yellow'  } as HorizontalSliderItem,
  ecwid:      { id: 'ecwid',    label: 'Ecwid',     tone: 'blue'    } as HorizontalSliderItem,
  pending:    { id: 'all',      label: 'Pending',   tone: 'purple'  } as HorizontalSliderItem,
  repair:     { id: 'all',      label: 'All',       tone: 'orange'  } as HorizontalSliderItem,
  stock:      { id: 'all',      label: 'All',       tone: 'red'     } as HorizontalSliderItem,
  receiving:  { id: 'all',      label: 'All',       tone: 'emerald' } as HorizontalSliderItem,
} as const;

function useHorizontalWheelScroll(ref: RefObject<HTMLDivElement | null>) {
  return useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (!el) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    [ref]
  );
}

export type HorizontalButtonSliderProps = {
  items: HorizontalSliderItem[];
  value: string;
  onChange: (id: string) => void;
  /** `fba`: ring pills with per-item tone. `slate`: dark pill when active (work order status). */
  variant?: 'fba' | 'slate';
  size?: 'md' | 'lg';
  className?: string;
  legend?: string;
  'aria-label'?: string;
};

export function HorizontalButtonSlider({
  items,
  value,
  onChange,
  variant = 'fba',
  size = 'md',
  className = '',
  legend,
  'aria-label': ariaLabel,
}: HorizontalButtonSliderProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const onWheel = useHorizontalWheelScroll(scrollerRef);

  const sizeCls =
    size === 'lg'
      ? 'min-h-10 px-3.5 py-2 text-[10px] tracking-wide'
      : 'h-8 px-3 text-[9px] tracking-wide';

  return (
    <div className={className}>
      {legend ? (
        <span className="mb-1.5 block text-[8px] font-black uppercase tracking-widest text-zinc-400">
          {legend}
        </span>
      ) : null}
      <div
        ref={scrollerRef}
        role="tablist"
        aria-label={ariaLabel || legend || 'Filter'}
        onWheel={onWheel}
        className="-mx-1 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex min-w-max snap-x snap-mandatory gap-2 px-1">
          {items.map((item) => {
            const isActive = value === item.id;
            if (variant === 'slate') {
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onChange(item.id)}
                  className={`snap-start whitespace-nowrap rounded-full border font-black uppercase transition-all ${sizeCls} ${
                    isActive
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {item.label}
                  {item.count != null && item.count > 0 ? (
                    <span className="ml-1.5 tabular-nums opacity-80">{item.count}</span>
                  ) : null}
                </button>
              );
            }

            const tone = FBA_TONE[item.tone ?? 'zinc'];
            return (
              <motion.button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                whileTap={{ scale: 0.92 }}
                onClick={() => onChange(item.id)}
                className={`snap-start whitespace-nowrap rounded-full font-black uppercase transition-colors ring-1 ring-inset ${sizeCls} ${
                  isActive
                    ? `${tone.activeBg} ${tone.activeText} ${tone.ring}`
                    : 'bg-white text-zinc-400 ring-zinc-200 hover:bg-zinc-50 hover:text-zinc-600'
                }`}
              >
                {item.label}
                {item.count != null && item.count > 0 ? (
                  <span className="ml-1.5 tabular-nums opacity-90">{item.count}</span>
                ) : null}
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
