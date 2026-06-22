'use client';

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/utils/_cn';

// ─── Panel ───────────────────────────────────────────────────────────────────
//
// The canonical *static* surface container — a settings card, a detail-panel
// section, a stat block. It is the calm sibling of <CardShell>: CardShell is the
// animated, selectable, tone-driven LIST ROW; Panel is a plain bordered surface
// you drop content into.
//
// Token-first: surface / border colors come from the semantic CSS-variable
// tokens (`bg-surface-card`, `border-border-soft`) so the panel themes for free
// (light/dark) without per-component `dark:` classes. Radius + shadow map onto
// the design-system scale (`radii`, `shadows`).
//
// Do NOT hand-roll `rounded-2xl border border-gray-200 bg-white shadow-sm`
// again — reach for <Panel> (and <PanelHeader> / <PanelFooter>) instead.

export type PanelPadding = 'none' | 'sm' | 'md' | 'lg';
export type PanelRadius = 'lg' | 'xl' | '2xl';
export type PanelElevation = 'none' | 'sm' | 'md';

const PADDING: Record<PanelPadding, string> = {
  none: 'p-0',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

const RADIUS: Record<PanelRadius, string> = {
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  '2xl': 'rounded-2xl',
};

const ELEVATION: Record<PanelElevation, string> = {
  none: '',
  sm: 'shadow-sm',
  md: 'shadow-md',
};

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  /** Inner padding from the spacing scale. Default `md`. */
  padding?: PanelPadding;
  /** Corner radius from the radius scale. Default `2xl`. */
  radius?: PanelRadius;
  /** Drop shadow from the elevation scale. Default `sm`. */
  elevation?: PanelElevation;
  /** Drop the border (e.g. for a nested/recessed panel). Default false. */
  borderless?: boolean;
}

export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel(
  { children, padding = 'md', radius = '2xl', elevation = 'sm', borderless = false, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'bg-surface-card text-text-default',
        !borderless && 'border border-border-soft',
        RADIUS[radius],
        ELEVATION[elevation],
        PADDING[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

// ─── PanelHeader ─────────────────────────────────────────────────────────────

export interface PanelHeaderProps {
  /** Primary title row. */
  title: ReactNode;
  /** Optional muted line under the title. */
  subtitle?: ReactNode;
  /** Trailing slot (e.g. an action button or status badge). */
  actions?: ReactNode;
  className?: string;
}

export function PanelHeader({ title, subtitle, actions, className }: PanelHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <div className="text-base font-black leading-tight text-text-default">{title}</div>
        {subtitle && <div className="mt-0.5 text-sm text-text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

// ─── PanelFooter ─────────────────────────────────────────────────────────────

export interface PanelFooterProps {
  children?: ReactNode;
  className?: string;
}

/** Action row separated from the panel body by a hairline divider. */
export function PanelFooter({ children, className }: PanelFooterProps) {
  return (
    <div className={cn('mt-5 flex flex-wrap items-center gap-2 border-t border-border-soft pt-5', className)}>
      {children}
    </div>
  );
}
