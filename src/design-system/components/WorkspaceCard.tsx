'use client';

import type { ReactNode } from 'react';

export type WorkspaceCardTone = 'blue' | 'emerald' | 'orange' | 'violet' | 'red' | 'gray';

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
  children,
}: WorkspaceCardProps) {
  const overflowClass = overflow === 'visible' ? 'overflow-visible' : 'overflow-hidden';
  return (
    <section
      className={`relative ${overflowClass} rounded-2xl bg-surface-card shadow-sm ring-1 ring-border-soft/60 ${
        className ?? ''
      }`}
    >
      {tone ? (
        <span
          aria-hidden
          className={`absolute inset-y-0 left-0 w-[3px] ${TONE_RAIL[tone]}`}
        />
      ) : null}
      {(label || actions) && (
        <header className="flex items-center justify-between gap-2 overflow-visible px-5 pb-1 pt-4">
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
      <div className={bodyClassName ?? 'px-5 py-4'}>{children}</div>
    </section>
  );
}
