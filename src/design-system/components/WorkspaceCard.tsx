'use client';

import type { ReactNode } from 'react';

export type WorkspaceCardTone = 'blue' | 'emerald' | 'orange' | 'violet' | 'red' | 'gray';

export type WorkspaceCardVariant = 'solid' | 'glass';

interface WorkspaceCardProps {
  /** Small uppercase tracking-wide label rendered in the card header. */
  label?: ReactNode;
  /** Optional trailing slot in the header row (e.g. badge, count chip). */
  actions?: ReactNode;
  /** Accent tone for the optional left rail; defaults to no rail. */
  tone?: WorkspaceCardTone;
  /** Extra class on the body wrapper (override padding, etc.). */
  bodyClassName?: string;
  /** Extra class on the outer section. */
  className?: string;
  /**
   * Outer overflow. Defaults to `hidden` (clips the tone rail to the radius).
   * Set `visible` when a child needs to escape the card — e.g. a dropdown or
   * hover popover anchored to a row inside the card.
   */
  overflow?: 'hidden' | 'visible';
  /**
   * Surface treatment. `solid` (default) is the classic white card. `glass` is
   * the frosted workspace surface: translucent themed card color +
   * backdrop-blur over the pane's ambient wash, hairline ring, soft shadow,
   * and a light-catch top hairline. The blur lives on an INSET SPAN, not the
   * section, so the card never becomes a stacking context — local hover menus
   * (chip action menus) keep painting over later sibling cards exactly as they
   * do on the solid variant.
   */
  variant?: WorkspaceCardVariant;
  children: ReactNode;
}

const TONE_RAIL: Record<WorkspaceCardTone, string> = {
  blue: 'bg-blue-500',
  emerald: 'bg-emerald-500',
  orange: 'bg-orange-500',
  violet: 'bg-violet-500',
  red: 'bg-rose-500',
  gray: 'bg-surface-strong',
};

/**
 * Floating white card surface used across the receiving workspace. Mirrors
 * the local `WorkspaceCard` in `src/components/MultiSkuSnBarcode.tsx` so the
 * two surfaces share a visual language; promoted here for reuse.
 *
 * The optional left rail picks up the receiving variant tone (PO → blue,
 * RETURN → red, etc.) — useful for visually grouping cards by record kind.
 */
export function WorkspaceCard({
  label,
  actions,
  tone,
  bodyClassName,
  className,
  overflow = 'hidden',
  variant = 'solid',
  children,
}: WorkspaceCardProps) {
  const overflowClass = overflow === 'visible' ? 'overflow-visible' : 'overflow-hidden';
  const glass = variant === 'glass';
  // Glass keeps ring + shadow on the SECTION (an element's own overflow never
  // clips its own box-shadow) and only the translucent fill + blur on the
  // inset span below (so the section never becomes a stacking context).
  const surfaceClass = glass
    ? 'rounded-3xl shadow-lg shadow-scrim/5 ring-1 ring-border-soft/60'
    : 'rounded-2xl bg-surface-card shadow-sm ring-1 ring-border-soft/60';
  // Glass: header/body get `relative` (positioned, z-auto) so they paint above
  // the inset glass span by DOM order — without introducing any z-index.
  const layerClass = glass ? 'relative' : '';
  return (
    <section className={`relative ${overflowClass} ${surfaceClass} ${className ?? ''}`}>
      {glass ? (
        <>
          <span
            aria-hidden
            className="absolute inset-0 rounded-3xl bg-surface-card/75 backdrop-blur-xl backdrop-saturate-150"
          />
          {/* Light-catch top hairline — the glass signature. `glass` is the
              scheme-independent white highlight token, correct on light and
              dark surfaces alike. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-glass/60 to-transparent"
          />
        </>
      ) : null}
      {tone ? (
        <span
          aria-hidden
          className={`absolute inset-y-0 left-0 w-[3px] ${glass ? 'rounded-l-3xl' : ''} ${TONE_RAIL[tone]}`}
        />
      ) : null}
      {(label || actions) && (
        <header
          className={`flex items-center justify-between gap-2 overflow-visible px-5 pb-1 pt-4 ${layerClass}`}
        >
          {label ? (
            <h3 className="min-w-0 shrink text-caption font-bold uppercase tracking-[0.14em] text-text-soft">
              {label}
            </h3>
          ) : (
            <span aria-hidden />
          )}
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </header>
      )}
      <div className={`${bodyClassName ?? 'px-5 py-4'} ${layerClass}`}>{children}</div>
    </section>
  );
}
