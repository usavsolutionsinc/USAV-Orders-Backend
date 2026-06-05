'use client';

import { useCallback, useRef, type WheelEvent } from 'react';
import { SOURCE_PLATFORM_OPTS } from '@/components/sidebar/receiving/receiving-sidebar-shared';

/** Display order for the source-platform pills (left → right). */
const PLATFORM_ORDER = [
  'ebay',
  'goodwill',
  'amazon',
  'fba',
  'aliexpress',
  'walmart',
  'ecwid',
  'other',
] as const;

/**
 * Horizontally-scrolling source-platform picker for the carton context card.
 * Owns its own scroller ref + wheel handler (vertical wheel → horizontal
 * scroll). Unmatched cartons get a synthesized front-end-only 'Unfound' pill
 * that is active until a real platform is chosen.
 */
export function SourcePlatformPills({
  disabled,
  isUnmatched,
  value,
  onSelect,
}: {
  /** Carton not linked yet — dim + disable interaction. */
  disabled: boolean;
  /** `receiving_source === 'unmatched'` — render the 'Unfound' pill. */
  isUnmatched: boolean;
  /** Current source_platform (lowercased), or '' for none/Unfound. */
  value: string;
  onSelect: (next: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const onWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    if (!el) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  }, []);

  return (
    <div
      aria-disabled={disabled || undefined}
      className={`min-w-0 flex-1 overflow-hidden ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      <div
        ref={scrollerRef}
        onWheel={onWheel}
        role="radiogroup"
        aria-label="Source platform"
        className="-mx-1 overflow-x-auto overscroll-x-contain px-1 py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex w-max items-center gap-1.5">
          {/* Synthesized 'Unfound' pill — only for unmatched cartons,
              auto-active until the operator picks a real platform.
              Front-end only: never written to source_platform. */}
          {isUnmatched ? (() => {
            const isActive = !value;
            return (
              <button
                key="unfound"
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => onSelect('')}
                title="No Zoho PO matched this carton"
                className={`inline-flex h-8 shrink-0 snap-start items-center whitespace-nowrap rounded-full border px-3 text-micro font-black uppercase tracking-wide transition-colors ${
                  isActive
                    ? 'border-amber-600 bg-amber-500 text-white'
                    : 'border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100'
                }`}
              >
                Unfound
              </button>
            );
          })() : null}
          {PLATFORM_ORDER
            .map((id) => SOURCE_PLATFORM_OPTS.find((o) => o.value === id))
            .filter((o): o is (typeof SOURCE_PLATFORM_OPTS)[number] => !!o)
            .map((opt) => {
              const isActive = (value || '') === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => onSelect(opt.value)}
                  className={`inline-flex h-8 shrink-0 snap-start items-center whitespace-nowrap rounded-full border px-3 text-micro font-black uppercase tracking-wide transition-colors ${
                    isActive
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}
