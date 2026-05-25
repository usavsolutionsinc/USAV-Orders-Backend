'use client';

import { useCallback, useRef, type RefObject, type WheelEvent } from 'react';
import { motion } from 'framer-motion';
import { framerTransition } from '@/design-system/foundations/motion-framer';

export type HorizontalSliderTone = 'zinc' | 'yellow' | 'emerald' | 'red' | 'blue' | 'orange' | 'purple';

export type HorizontalSliderItem = {
  id: string;
  label: string;
  count?: number;
  /** Used when variant is `fba`. */
  tone?: HorizontalSliderTone;
  /**
   * Leading icon. Used by the `nav` variant where desktop pills collapse to
   * icon-only and reveal the label on hover (or when active). Ignored by
   * other variants.
   */
  icon?: (props: { className?: string }) => JSX.Element;
  /**
   * Renders the pill as a non-interactive placeholder (e.g. "coming soon"
   * sections). Currently honored by the `nav` variant.
   */
  disabled?: boolean;
  /**
   * Status badge overlay — `'dot'` paints a small emerald dot at the top-right
   * of the pill to signal "there's something on this tab" without affecting
   * the click target. Honored by the `nav` variant.
   */
  badge?: 'dot' | null;
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
  /**
   * Active-state visual language:
   *   - `fba`      — ring pills with per-item tone (FBA filter rows).
   *   - `slate`    — dark pill when active (work-order status).
   *   - `nav`      — filled blue active state matching the global sidebar nav
   *                  (sub-view switchers inside sidebar panels). Adds a subtle
   *                  scale-up on the active pill so the eye locks onto it.
   *   - `floating` — borderless white pills with drop shadows that look like
   *                  Google Maps filter chips floating over content.
   */
  variant?: 'fba' | 'slate' | 'nav' | 'floating';
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
      ? 'min-h-10 px-3.5 py-2 text-micro tracking-wide'
      : 'h-8 px-3 text-eyebrow tracking-wide';

  // The `nav` variant uses scale-up + shadow on the active pill; the
  // overflow-x-auto would clip those on the Y axis too (browser quirk),
  // so we give the scroller vertical breathing room.
  const scrollerPadY = variant === 'nav' ? 'py-2' : 'pb-0.5';

  // `floating` pills always fit on a phone — skip the scroller entirely so
  // the pill drop shadows aren't clipped by overflow-x-auto's implicit
  // y-clip. Gives shadows a visible vertical bleed area instead.
  const useScroller = variant !== 'floating';
  const containerClass = useScroller
    ? `-mx-1 overflow-x-auto overscroll-x-contain ${scrollerPadY} [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden`
    : 'overflow-visible py-2';

  return (
    <div className={className}>
      {legend ? (
        <span className="mb-1.5 block text-mini font-black uppercase tracking-widest text-zinc-400">
          {legend}
        </span>
      ) : null}
      <div
        ref={scrollerRef}
        role="tablist"
        aria-label={ariaLabel || legend || 'Filter'}
        onWheel={useScroller ? onWheel : undefined}
        className={containerClass}
      >
        <div
          className={
            useScroller
              ? 'flex min-w-max snap-x snap-mandatory gap-2 px-1'
              : 'flex flex-wrap gap-2'
          }
        >
          {items.map((item) => {
            const isActive = value === item.id;
            if (variant === 'nav') {
              const Icon = item.icon;
              const isDisabled = !!item.disabled;
              // Only indent the label when an icon is present — otherwise text
              // would sit off-center (empty space reserved for a missing icon).
              const labelClass = Icon ? 'ml-1.5 max-w-[160px]' : 'max-w-[160px]';
              const stateClass = isDisabled
                ? 'cursor-not-allowed bg-gray-50 text-gray-400 ring-gray-200'
                : isActive
                  ? 'bg-blue-600 text-white ring-blue-600 shadow-md shadow-blue-600/25'
                  : 'bg-white text-gray-500 ring-gray-200 hover:bg-gray-50 hover:text-gray-900 hover:ring-gray-300';
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-disabled={isDisabled || undefined}
                  aria-label={isDisabled ? `${item.label} (coming soon)` : item.label}
                  title={isDisabled ? `${item.label} (coming soon)` : item.label}
                  disabled={isDisabled}
                  animate={{ scale: isActive && !isDisabled ? 1.04 : 1 }}
                  transition={framerTransition.sliderIndicator}
                  whileTap={isDisabled ? undefined : { scale: 0.96 }}
                  onClick={isDisabled ? undefined : () => onChange(item.id)}
                  className={`group relative inline-flex snap-start items-center whitespace-nowrap rounded-full font-black uppercase transition-colors ring-1 ring-inset ${sizeCls} ${stateClass}`}
                >
                  {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
                  <span className={`inline-block whitespace-nowrap ${labelClass}`}>
                    {item.label}
                  </span>
                  {item.count != null && item.count > 0 ? (
                    <span className={`ml-1.5 shrink-0 tabular-nums ${isActive ? 'opacity-90' : 'opacity-70'}`}>{item.count}</span>
                  ) : null}
                  {item.badge === 'dot' ? (
                    <span
                      className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ${
                        isActive ? 'bg-white ring-blue-600' : 'bg-emerald-500 ring-white'
                      }`}
                      aria-hidden
                    />
                  ) : null}
                </motion.button>
              );
            }

            if (variant === 'floating') {
              const Icon = item.icon;
              const stateClass = isActive
                ? 'bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,0.35)]'
                : 'bg-white text-gray-700 shadow-[0_1px_4px_rgba(15,23,42,0.14)] hover:bg-gray-50';
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={item.label}
                  animate={{ scale: isActive ? 1.04 : 1 }}
                  transition={framerTransition.sliderIndicator}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => onChange(item.id)}
                  className={`group relative inline-flex snap-start items-center whitespace-nowrap rounded-full font-black uppercase transition-colors ${sizeCls} ${stateClass}`}
                >
                  {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
                  <span className={`inline-block whitespace-nowrap ${Icon ? 'ml-1.5' : ''} max-w-[160px]`}>
                    {item.label}
                  </span>
                  {item.count != null && item.count > 0 ? (
                    <span className={`ml-1.5 shrink-0 tabular-nums ${isActive ? 'opacity-90' : 'opacity-70'}`}>{item.count}</span>
                  ) : null}
                </motion.button>
              );
            }

            if (variant === 'slate') {
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  animate={{ scale: isActive ? 1.03 : 1 }}
                  transition={framerTransition.sliderIndicator}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => onChange(item.id)}
                  className={`snap-start whitespace-nowrap rounded-full border font-black uppercase transition-colors ${sizeCls} ${
                    isActive
                      ? 'border-gray-900 bg-gray-900 text-white shadow-md shadow-gray-900/20'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {item.label}
                  {item.count != null && item.count > 0 ? (
                    <span className="ml-1.5 tabular-nums opacity-80">{item.count}</span>
                  ) : null}
                </motion.button>
              );
            }

            const tone = FBA_TONE[item.tone ?? 'zinc'];
            return (
              <motion.button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                animate={{ scale: isActive ? 1.03 : 1 }}
                transition={framerTransition.sliderIndicator}
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
