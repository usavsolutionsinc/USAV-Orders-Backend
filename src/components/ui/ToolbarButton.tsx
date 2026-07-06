'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/utils/_cn';

/**
 * ToolbarButton — the single visual method for a Linear-style **view toolbar**.
 *
 * Every control in a board/view header (the layout toggle, staff filter, columns
 * config, select) renders through this one primitive — or {@link ToolbarSegmentGroup}
 * for mutually exclusive icon toggles — so the toolbar reads as one consistent
 * system rather than four look-alikes that drift on radius, border, and active color.
 *
 *   • `h-8`, `rounded-lg`, soft **inset** ring (never a box-growing border)
 *   • white `surface-card` at rest; hover lifts the surface + ring
 *   • **solid-blue fill** when `active` — the one unmistakable "selected/on" state
 *   • icon-only square by default (`w-8`); pass children for a labeled pill
 *     (leading icon + text + trailing chevron)
 *
 * It `forwardRef`s and spreads props so it can be a Radix `Popover.Trigger asChild`
 * child (staff/columns popovers) or a plain toggle (select). Wrap in
 * {@link HoverTooltip} where the control has no visible label.
 *
 * This is the presentational shell only — it owns no open/selected state. Active
 * color is semantic-token blue (the house "selected" hue); do not fork per-control.
 */
export interface ToolbarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Solid-blue "selected / on" fill. */
  active?: boolean;
  /** Square icon-only control (width locks to the height). Omit for a labeled pill. */
  iconOnly?: boolean;
  children?: ReactNode;
}

export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  function ToolbarButton(
    { active = false, iconOnly = false, className, type = 'button', children, ...rest },
    ref,
  ) {
    return (
      // ds-raw-button: shared view-toolbar control; solid-blue active fill no single DS Button variant expresses.
      <button
        ref={ref}
        type={type}
        data-active={active || undefined}
        className={cn(
          'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg text-eyebrow font-black uppercase tracking-widest ring-1 ring-inset transition-colors active:scale-95',
          iconOnly ? 'w-8' : 'px-2.5',
          active
            ? 'bg-blue-600 text-white ring-blue-600 shadow-sm shadow-blue-600/25'
            : 'bg-surface-card text-text-muted ring-border-soft hover:bg-surface-hover hover:text-text-default hover:ring-border-default',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

/** One icon tab inside {@link ToolbarSegmentGroup}. */
export type ToolbarSegmentItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

/**
 * Grouped icon-only toggles that share one toolbar shell — same outer ring,
 * height, and solid-blue active fill as {@link ToolbarButton}, with a hairline
 * between segments. Use for mutually exclusive view modes (e.g. 1-up / 2-up).
 */
export function ToolbarSegmentGroup({
  items,
  value,
  onChange,
  'aria-label': ariaLabel,
}: {
  items: ToolbarSegmentItem[];
  value: string;
  onChange: (id: string) => void;
  'aria-label'?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex h-8 shrink-0 overflow-hidden rounded-lg bg-surface-card ring-1 ring-inset ring-border-soft"
    >
      {items.map((item, i) => {
        const Icon = item.icon;
        const active = value === item.id;
        return (
          // ds-raw-button: segmented toolbar tab; shares ToolbarButton active/hover language.
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            aria-label={item.label}
            title={item.label}
            onClick={() => onChange(item.id)}
            className={cn(
              'inline-flex h-8 w-8 shrink-0 items-center justify-center transition-colors active:scale-95',
              i > 0 && 'border-l border-border-soft',
              active
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/25'
                : 'text-text-muted hover:bg-surface-hover hover:text-text-default',
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
