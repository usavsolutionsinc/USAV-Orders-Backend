'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { Loader2 } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { useUIModeOptional } from '../providers/UIModeProvider';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'brand' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Button content. Hidden on mobile when `iconOnly` is set (label moves to aria-label). */
  children?: ReactNode;
  /** Visual variant. */
  variant?: ButtonVariant;
  /** Size — `md` is default. Mobile mode auto-promotes every size to a 44px+ touch target. */
  size?: ButtonSize;
  /** Leading icon node (e.g. `<Plus />`). Sized automatically by `size`. */
  icon?: ReactNode;
  /** Trailing icon node. Ignored while loading / icon-only. */
  iconRight?: ReactNode;
  /** Loading state — swaps content for a spinner and disables interaction. */
  loading?: boolean;
  /**
   * On mobile, render only the icon (square button). The text content becomes the
   * `aria-label`. Requires `icon`. On desktop the label stays visible.
   */
  iconOnly?: boolean;
  /** Accessible label — required when `iconOnly` and children aren't a plain string. */
  ariaLabel?: string;
}

// ─── Variant classes ─────────────────────────────────────────────────────────

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 text-white shadow-sm shadow-blue-600/25 hover:bg-blue-500 active:bg-blue-700',
  brand:
    'text-white shadow-sm shadow-navy-900/30 bg-gradient-to-b from-navy-700 to-navy-900 hover:from-navy-600 hover:to-navy-800',
  secondary: 'bg-surface-card text-text-default ring-1 ring-border-soft hover:bg-surface-canvas active:bg-surface-canvas',
  ghost: 'text-text-muted hover:bg-surface-canvas hover:text-text-default active:bg-surface-canvas',
  danger: 'bg-rose-600 text-white shadow-sm shadow-rose-600/25 hover:bg-rose-500 active:bg-rose-700',
};

// ─── Size classes ────────────────────────────────────────────────────────────

const desktopSize: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-lg px-3 text-[12px]',
  md: 'h-9 gap-1.5 rounded-xl px-3.5 text-[13px]',
  lg: 'h-10 gap-2 rounded-xl px-5 text-sm',
};

// Mobile — every size meets the 44px minimum touch target.
const mobileSize: Record<ButtonSize, string> = {
  sm: 'h-11 gap-2 rounded-xl px-4 text-[13px]',
  md: 'h-12 gap-2 rounded-2xl px-5 text-sm',
  lg: 'h-14 gap-2.5 rounded-2xl px-6 text-base',
};

// Icon-only squares (mobile).
const mobileIconOnly: Record<ButtonSize, string> = {
  sm: 'h-11 w-11 rounded-xl',
  md: 'h-12 w-12 rounded-2xl',
  lg: 'h-14 w-14 rounded-2xl',
};

const iconBox: Record<ButtonSize, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-4 w-4',
};

const spring = { type: 'spring', stiffness: 520, damping: 36 } as const;

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Button — the canonical button primitive.
 *
 * One component, five variants. Replaces the ~1,300 hand-rolled
 * `<button className="bg-… px-… rounded-…">` scattered across the app.
 *
 * - Children-based API: `<Button variant="brand" icon={<Plus />}>Save</Button>`
 * - Spring press feedback (framer-motion `whileTap`) on every variant
 * - Mode-aware: promotes to 44px+ touch targets on mobile via `UIModeProvider`
 * - Built-in `loading` (spinner swap) and `iconOnly` (mobile square) states
 *
 * `PrimaryButton` is a thin label-based adapter over this component — prefer
 * `Button` for new code.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    variant = 'primary',
    size = 'md',
    icon,
    iconRight,
    loading = false,
    iconOnly = false,
    ariaLabel,
    disabled = false,
    className,
    type = 'button',
    ...rest
  },
  ref,
) {
  const { isMobile } = useUIModeOptional();
  const isDisabled = disabled || loading;
  const isIconOnly = isMobile && iconOnly && !!icon;

  const sizeClass = isIconOnly
    ? mobileIconOnly[size]
    : isMobile
      ? mobileSize[size]
      : desktopSize[size];

  const renderIcon = (node: ReactNode) => (
    <span className={cn('flex shrink-0 items-center justify-center', iconBox[size], '[&>svg]:h-full [&>svg]:w-full')}>
      {node}
    </span>
  );

  return (
    <motion.button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-label={isIconOnly ? ariaLabel ?? (typeof children === 'string' ? children : undefined) : ariaLabel}
      aria-busy={loading || undefined}
      whileTap={isDisabled ? undefined : { scale: 0.96 }}
      transition={spring}
      className={cn(
        'inline-flex select-none items-center justify-center font-semibold',
        'transition-colors duration-150 ease-out outline-none',
        'focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-60',
        variantClasses[variant],
        sizeClass,
        className,
      )}
      {...(rest as HTMLMotionProps<'button'>)}
    >
      {loading ? (
        <>
          {renderIcon(<Loader2 className="animate-spin" />)}
          {!isIconOnly && children}
        </>
      ) : (
        <>
          {icon && renderIcon(icon)}
          {!isIconOnly && children}
          {iconRight && !isIconOnly && renderIcon(iconRight)}
        </>
      )}
    </motion.button>
  );
});
