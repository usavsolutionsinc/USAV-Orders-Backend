'use client';

import { useCallback, useId, useRef, type RefObject, type WheelEvent } from 'react';
import { motion } from 'framer-motion';
import { receivingHeaderHairlineClass } from '@/components/layout/header-shell';
import { framerTransition } from '@/design-system/foundations/motion-framer';
import { cn } from '@/utils/_cn';

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
   *   - `segmented` — icon-only tabs that split the width evenly (flex-1). The
   *                  active tab is a filled blue square with a sliding indicator;
   *                  inactive tabs are borderless grayed icons. The selection's
   *                  name is meant to live in the sidebar header, not on the tab.
   */
  variant?: 'fba' | 'slate' | 'nav' | 'floating' | 'segmented';
  size?: 'md' | 'lg';
  /**
   * Tighter vertical rhythm for the `nav` variant — drops the scroller's
   * vertical padding from `py-2` to `py-1` so the row fits a 40px band exactly
   * (32px pill + 8px). Used by header bands that must align on a 40px grid.
   */
  dense?: boolean;
  className?: string;
  legend?: string;
  /**
   * When `variant` is `nav`, render icon-only tabs (labels still drive
   * `aria-label` / `title`). Compact square-ish hit targets for tight headers.
   */
  navIconOnly?: boolean;
  /**
   * Square, edge-to-edge segmented track for full-bleed sidebar bands (e.g.
   * master-nav `ModeRail`). Drops outer radius, inset padding, and the track
   * ring so the gray fill meets the panel edges.
   */
  segmentedFlush?: boolean;
  'aria-label'?: string;
};

export function HorizontalButtonSlider({
  items,
  value,
  onChange,
  variant = 'fba',
  size = 'md',
  dense = false,
  className = '',
  legend,
  navIconOnly = false,
  segmentedFlush = false,
  'aria-label': ariaLabel,
}: HorizontalButtonSliderProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const onWheel = useHorizontalWheelScroll(scrollerRef);
  // Stable per-instance id so each `segmented` slider animates its own indicator
  // (sharing a layoutId across instances would make pills teleport between them).
  const indicatorId = useId();

  const sizeCls =
    size === 'lg'
      ? 'min-h-10 px-3.5 py-2 text-micro tracking-wide'
      : 'h-8 px-3 text-eyebrow tracking-wide';

  // The `nav` variant uses scale-up + shadow on the active pill. Setting
  // overflow-x-auto forces overflow-y to compute as auto too (CSS spec), so
  // drop shadows get clipped unless the scroller has extra bottom padding.
  // shadow-md needs ~10px bleed; dense keeps top tight for the 40px grid.
  const scrollerPadY =
    variant === 'nav' ? (dense ? 'pt-1 pb-2.5' : 'pt-2 pb-3') : 'pb-0.5';

  // `floating` and `segmented` always fit (segmented splits the width evenly),
  // so they skip the scroller — floating to avoid clipping pill shadows,
  // segmented so flex-1 children can stretch instead of sitting min-w-max.
  const isSegmented = variant === 'segmented';
  const useScroller = variant !== 'floating' && !isSegmented;
  const containerClass = isSegmented
    ? segmentedFlush
      ? // Full-bleed sidebar band: square white fill + bottom hairline (matches header bands).
        cn('h-full rounded-none bg-white p-0', receivingHeaderHairlineClass)
      : // Recessed gray track (bg-surface-canvas + inset ring) so the active blue
        // pill reads as raised. p-1 + h-8 tabs = 40px in a fixed 40px band.
        'rounded-xl bg-surface-canvas p-1 ring-1 ring-inset ring-border-soft'
    : useScroller
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
            isSegmented
              ? segmentedFlush
                ? 'flex h-full gap-0'
                : 'flex gap-1'
              : useScroller
                ? 'flex min-w-max snap-x snap-mandatory gap-2 px-1'
                : 'flex flex-wrap gap-2'
          }
        >
          {items.map((item) => {
            const isActive = value === item.id;
            if (variant === 'segmented') {
              const Icon = item.icon;
              const segTabClass = segmentedFlush
                ? 'relative flex h-full min-h-[40px] flex-1 items-center justify-center rounded-none'
                : 'relative flex h-8 flex-1 items-center justify-center rounded-xl';
              const segIndicatorClass = segmentedFlush
                ? 'absolute inset-0 rounded-none bg-blue-600'
                : 'absolute inset-0 rounded-xl bg-blue-600 shadow-sm shadow-blue-600/25';
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={item.label}
                  title={item.label}
                  whileTap={{ scale: 0.94 }}
                  transition={framerTransition.sliderIndicator}
                  onClick={() => onChange(item.id)}
                  className={`${segTabClass} transition-colors ${
                    isActive ? 'text-white' : 'text-text-muted hover:text-text-default'
                  }`}
                >
                  {isActive ? (
                    <motion.span
                      layoutId={`${indicatorId}-seg`}
                      className={segIndicatorClass}
                      transition={framerTransition.sliderIndicator}
                    />
                  ) : null}
                  {Icon ? <Icon className="relative z-10 h-[18px] w-[18px]" /> : null}
                  {item.badge === 'dot' ? (
                    <span className="absolute right-1.5 top-1.5 z-10 h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                  ) : null}
                </motion.button>
              );
            }
            if (variant === 'nav') {
              const Icon = item.icon;
              const isDisabled = !!item.disabled;
              // `dense` pills lock to a flat 32px (h-8) with no active scale-up
              // so they sit cleanly inside a 40px grid row (32 + py-1*2).
              const navSizeCls = navIconOnly
                ? 'h-8 w-8 min-w-8 shrink-0 justify-center p-0'
                : dense
                  ? 'h-8 shrink-0 px-3 text-eyebrow tracking-wide'
                  : sizeCls;
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
                  animate={{ scale: isActive && !isDisabled && !dense ? 1.04 : 1 }}
                  transition={framerTransition.sliderIndicator}
                  whileTap={isDisabled ? undefined : { scale: 0.96 }}
                  onClick={isDisabled ? undefined : () => onChange(item.id)}
                  className={`group relative inline-flex snap-start items-center whitespace-nowrap rounded-full font-black uppercase transition-colors ring-1 ring-inset ${navSizeCls} ${stateClass}`}
                >
                  {Icon ? (
                    <Icon className={`shrink-0 ${navIconOnly ? 'h-3 w-3' : 'h-3.5 w-3.5'}`} />
                  ) : null}
                  {navIconOnly ? null : (
                    <span className={`inline-block whitespace-nowrap ${labelClass}`}>{item.label}</span>
                  )}
                  {!navIconOnly && item.count != null && item.count > 0 ? (
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
