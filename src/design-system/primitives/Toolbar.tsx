'use client';

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/utils/_cn';

// ─── Toolbar ─────────────────────────────────────────────────────────────────
//
// The canonical horizontal action strip — a header band that holds a title, a
// search/filter cluster, and trailing actions. The generic primitive behind the
// ~handful of bespoke `*Toolbar` components (ShippedFilterToolbar,
// SkuGraphToolbar, LineEditToolbar …) which each re-rolled the same flex row.
//
// Token-first: surface + border come from the semantic tokens so it themes for
// free. Use the `start` / `center` / `end` slots, or pass children directly.

export type ToolbarTone = 'surface' | 'transparent';

const TONE: Record<ToolbarTone, string> = {
  surface: 'bg-surface-card border-b border-border-soft',
  transparent: 'bg-transparent',
};

export interface ToolbarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Leading slot — typically a title or back affordance. */
  start?: ReactNode;
  /** Centered slot — typically a search field or segmented control. */
  center?: ReactNode;
  /** Trailing slot — typically primary/secondary action buttons. */
  end?: ReactNode;
  /** Free-form children render in place of the slotted layout. */
  children?: ReactNode;
  /** Background treatment. Default `surface`. */
  tone?: ToolbarTone;
}

export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(function Toolbar(
  { start, center, end, children, tone = 'surface', className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('flex h-12 items-center gap-3 px-4', TONE[tone], className)}
      {...rest}
    >
      {children ?? (
        <>
          {start && <div className="flex min-w-0 items-center gap-2">{start}</div>}
          {center && <div className="flex min-w-0 flex-1 items-center justify-center gap-2">{center}</div>}
          {!center && <div className="flex-1" />}
          {end && <div className="flex shrink-0 items-center gap-2">{end}</div>}
        </>
      )}
    </div>
  );
});

/** Visual divider between toolbar clusters. */
export function ToolbarSeparator({ className }: { className?: string }) {
  return <span className={cn('h-5 w-px bg-border-soft', className)} aria-hidden="true" />;
}
