'use client';

import type { ReactNode } from 'react';
import { Check, Loader2 } from '@/components/Icons';

export type StickyActionTone = 'blue' | 'emerald' | 'orange' | 'violet' | 'red' | 'gray';

interface PrimaryAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  tone?: StickyActionTone;
  icon?: ReactNode;
}

interface SecondaryAction {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  disabled?: boolean;
}

interface Hint {
  /** Key glyph, e.g. "⏎", "⌘P", "Esc". */
  key: string;
  label: string;
}

interface StickyActionBarProps {
  primary: PrimaryAction;
  secondary?: SecondaryAction;
  hints?: Hint[];
  /** Max width of the inner content. Defaults to `max-w-3xl`. */
  maxWidth?: string;
  /** Extra class on the outer wrapper (override bg, padding, etc.). */
  className?: string;
}

const TONE_BG: Record<StickyActionTone, string> = {
  blue: 'bg-blue-600 hover:bg-blue-700',
  emerald: 'bg-emerald-600 hover:bg-emerald-700',
  orange: 'bg-orange-600 hover:bg-orange-700',
  violet: 'bg-violet-700 hover:bg-violet-800',
  red: 'bg-rose-600 hover:bg-rose-700',
  gray: 'bg-gray-700 hover:bg-gray-800',
};

/**
 * Sticky bottom action bar — primary CTA on the right, optional secondary
 * button + keyboard hint chips on the left. Mirrors the local
 * `StickyActionBar` in `src/components/MultiSkuSnBarcode.tsx` (lines
 * 1202-1246) so the two surfaces share a visual language; promoted here
 * for reuse.
 *
 * Pinned `bottom-0 z-10` inside its containing scroll surface. Parent must
 * leave room (e.g. `pb-32` on the scroll inner) so content isn't hidden.
 */
export function StickyActionBar({
  primary,
  secondary,
  hints,
  maxWidth = 'max-w-3xl',
  className,
}: StickyActionBarProps) {
  const tone = primary.tone ?? 'blue';
  const toneClass = primary.disabled
    ? 'cursor-not-allowed bg-gray-300'
    : TONE_BG[tone];
  return (
    <div
      className={`sticky bottom-0 z-10 border-t border-gray-200 bg-white/90 px-4 py-3 backdrop-blur sm:px-6 ${
        className ?? ''
      }`}
    >
      <div className={`mx-auto flex w-full ${maxWidth} items-center justify-between gap-4`}>
        <div className="hidden items-center gap-3 text-xs text-gray-500 sm:flex">
          {hints?.map((h) => (
            <span key={`${h.key}-${h.label}`} className="inline-flex items-center gap-1.5">
              <kbd className="rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-gray-600">
                {h.key}
              </kbd>
              <span className="font-semibold uppercase tracking-[0.14em]">{h.label}</span>
            </span>
          ))}
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 sm:flex-initial">
          {secondary ? (
            <button
              type="button"
              onClick={secondary.onClick}
              disabled={secondary.disabled}
              className="inline-flex h-12 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-40"
            >
              {secondary.icon}
              <span>{secondary.label}</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={primary.onClick}
            disabled={primary.disabled || primary.isLoading}
            className={`inline-flex h-12 flex-1 items-center justify-center gap-2.5 rounded-xl px-6 text-sm font-bold text-white shadow-sm transition-all sm:flex-initial sm:min-w-[220px] ${toneClass}`}
          >
            {primary.isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{primary.label}</span>
              </>
            ) : (
              <>
                {primary.icon ?? <Check className="h-4 w-4" />}
                <span>{primary.label}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
