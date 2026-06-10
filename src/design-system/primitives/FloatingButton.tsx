'use client';

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, Loader2 } from '@/components/Icons';
import { cn } from '@/utils/_cn';

// ─── Types ───────────────────────────────────────────────────────────────────

export type FloatingButtonTone = 'blue' | 'emerald' | 'orange' | 'violet' | 'red' | 'gray';

export interface FloatingButtonMenuItem {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  title?: string;
}

export interface FloatingButtonProps {
  /** CTA label. */
  label: string;
  /** Primary click handler. */
  onClick: () => void;
  /** Leading icon node. */
  icon?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  /** Title attribute for the CTA (explains disabled states). */
  title?: string;
  /** Tone preset. Ignored when `toneClasses` is set. Defaults to `emerald`. */
  tone?: FloatingButtonTone;
  /** Override the tone with arbitrary Tailwind classes (e.g. a per-row theme). */
  toneClasses?: { bg: string; hover: string };
  /** Optional split-button menu — a chevron on the left opens an upward menu
   *  on hover/focus. */
  menu?: FloatingButtonMenuItem[];
  /** aria-label for the chevron trigger. Defaults to "More actions". */
  menuLabel?: string;
  /** title attribute for the chevron trigger. */
  menuTitle?: string;
  /** Max width of the centered container. Match the host column (e.g. a
   *  `max-w-3xl` workspace) so the pill lines up with the content above it.
   *  Defaults to `max-w-3xl`. */
  maxWidth?: string;
  /** Stretch the pill to fill `maxWidth`. Default `false` — a compact,
   *  auto-width pill centered within the container. */
  fullWidth?: boolean;
  /** Extra class on the sticky outer wrapper (override z-index, padding, etc.). */
  className?: string;
}

const TONE_BG_SOLID: Record<FloatingButtonTone, string> = {
  blue: 'bg-blue-600',
  emerald: 'bg-emerald-600',
  orange: 'bg-orange-600',
  violet: 'bg-violet-700',
  red: 'bg-rose-600',
  gray: 'bg-gray-900',
};

const spring = { type: 'spring', stiffness: 520, damping: 36 } as const;

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * FloatingButton — a floating action button docked to the bottom of its host
 * pane. Unlike a full-bleed `StickyActionBar`, it renders just the pill (no
 * backing band) and is `absolute`-pinned to the bottom edge, so it sits at the
 * bottom of the page even when the content above it doesn't fill the height
 * (where `sticky` would fall back to mid-flow).
 *
 * - Click-through wrapper (`pointer-events-none`) so it never blocks content;
 *   the pill itself re-enables clicks.
 * - Centered within `maxWidth` so it lines up with the host content column
 *   (pass the same `max-w-*` token the column uses). Set `fullWidth` to stretch
 *   the pill across that width, or leave it for a compact centered pill.
 * - Pass `menu` to make it a split button: a chevron on the left opens an
 *   upward menu on hover/focus.
 * - Spring press feedback (framer-motion `whileTap`) like the `Button` primitive.
 *
 * The host must be `position: relative` and full-height; the scroll surface
 * above should reserve bottom room (e.g. `pb-32`) so the last item clears the
 * pill.
 */
export function FloatingButton({
  label,
  onClick,
  icon,
  disabled = false,
  loading = false,
  title,
  tone = 'emerald',
  toneClasses,
  menu,
  menuLabel,
  menuTitle,
  maxWidth = 'max-w-3xl',
  fullWidth = false,
  className,
}: FloatingButtonProps) {
  const isDisabled = disabled || loading;
  const solidBg = isDisabled
    ? 'bg-gray-300'
    : toneClasses
      ? toneClasses.bg
      : TONE_BG_SOLID[tone];
  const hasMenu = Array.isArray(menu) && menu.length > 0;

  const leadingIcon = loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon;

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:px-6',
        className,
      )}
    >
      <div
        className={cn(
          'pointer-events-auto mx-auto flex w-full',
          maxWidth,
          fullWidth ? '' : 'justify-center',
        )}
      >
        {hasMenu ? (
          <motion.div
            whileTap={isDisabled ? undefined : { scale: 0.99 }}
            transition={spring}
            className={cn(
              'relative z-20 flex overflow-visible rounded-2xl shadow-lg shadow-black/15 ring-1 ring-black/5 transition-[filter] duration-100',
              isDisabled ? 'cursor-not-allowed' : 'hover:brightness-[0.96] active:brightness-[0.92]',
              solidBg,
              fullWidth ? 'w-full min-w-0' : 'max-w-full',
            )}
          >
            <div className="group/split-menu relative flex shrink-0 self-stretch">
              <button
                type="button"
                aria-haspopup="menu"
                aria-label={menuLabel ?? 'More actions'}
                title={menuTitle}
                disabled={isDisabled}
                className="flex h-12 items-center justify-center rounded-l-2xl border-r border-white/20 bg-transparent px-3 text-white outline-none transition-[filter] focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ChevronDown className="h-4 w-4 opacity-95" />
              </button>
              <div
                className="invisible absolute bottom-full left-0 z-dropdown pb-0.5 opacity-0 transition-opacity duration-75 group-hover/split-menu:pointer-events-auto group-hover/split-menu:visible group-hover/split-menu:opacity-100 group-focus-within/split-menu:pointer-events-auto group-focus-within/split-menu:visible group-focus-within/split-menu:opacity-100"
                role="presentation"
              >
                <ul
                  role="menu"
                  aria-label={menuLabel ?? 'More actions'}
                  className="min-w-[12rem] rounded-lg border border-slate-200 bg-white py-1 shadow-xl ring-1 ring-slate-200/80"
                >
                  {menu!.map((item) => (
                    <li key={item.label} role="none">
                      <button
                        role="menuitem"
                        type="button"
                        disabled={item.disabled}
                        title={item.title}
                        onClick={(e) => {
                          e.stopPropagation();
                          item.onClick();
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-caption font-black uppercase tracking-wider text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        {item.icon}
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <button
              type="button"
              onClick={onClick}
              disabled={isDisabled}
              title={title}
              className={cn(
                'inline-flex h-12 min-w-0 items-center justify-center gap-2 rounded-r-2xl bg-transparent px-6 text-sm font-bold text-white outline-none transition-[filter] focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-60',
                fullWidth ? 'flex-1' : '',
              )}
            >
              {leadingIcon}
              <span className="truncate">{label}</span>
            </button>
          </motion.div>
        ) : (
          <motion.button
            type="button"
            onClick={onClick}
            disabled={isDisabled}
            title={title}
            whileTap={isDisabled ? undefined : { scale: 0.99 }}
            transition={spring}
            className={cn(
              'inline-flex h-12 items-center justify-center gap-2.5 rounded-2xl px-6 text-sm font-bold text-white shadow-lg shadow-black/15 ring-1 ring-black/5 outline-none transition-[filter] focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-60',
              isDisabled ? '' : 'hover:brightness-[0.96] active:brightness-[0.92]',
              solidBg,
              fullWidth ? 'w-full min-w-0' : 'max-w-full',
            )}
          >
            {leadingIcon}
            <span className="truncate">{label}</span>
          </motion.button>
        )}
      </div>
    </div>
  );
}
