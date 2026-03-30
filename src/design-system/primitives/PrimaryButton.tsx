'use client';

import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useUIModeOptional } from '../providers/UIModeProvider';

// ─── Types ───────────────────────────────────────────────────────────────────

type ButtonTone = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface PrimaryButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Button label text. Hidden on mobile when `iconOnly` is true. */
  label: string;
  /** Leading icon — rendered before label (or alone on mobile). */
  icon?: ReactNode;
  /** Trailing icon — rendered after label. */
  trailingIcon?: ReactNode;
  /** Visual tone. */
  tone?: ButtonTone;
  /** Size — `md` is default. Mobile mode auto-promotes `sm` → `md` for touch targets. */
  size?: ButtonSize;
  /** On mobile, show only the icon (label becomes aria-label). Requires `icon`. */
  iconOnly?: boolean;
  /** Loading state — shows spinner, disables interaction. */
  isLoading?: boolean;
}

// ─── Tone classes ────────────────────────────────────────────────────────────

const toneClasses: Record<ButtonTone, string> = {
  primary: 'bg-gray-900 text-white hover:bg-black active:bg-gray-800 shadow-sm',
  secondary: 'bg-white text-gray-900 border border-gray-200 hover:bg-gray-50 active:bg-gray-100 shadow-sm',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 shadow-sm',
  ghost: 'bg-transparent text-gray-700 hover:bg-gray-100 active:bg-gray-200',
};

// ─── Size classes (desktop) ──────────────────────────────────────────────────

const desktopSizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[11px] gap-1.5 rounded-lg',
  md: 'h-9 px-4 text-[12px] gap-2 rounded-xl',
  lg: 'h-10 px-5 text-[13px] gap-2 rounded-xl',
};

// ─── Size classes (mobile) — larger touch targets ────────────────────────────

const mobileSizeClasses: Record<ButtonSize, string> = {
  sm: 'h-11 px-4 text-[12px] gap-2 rounded-xl',   // Promoted from h-8 → h-11 (44px min)
  md: 'h-12 px-5 text-[12px] gap-2.5 rounded-2xl',
  lg: 'h-14 px-6 text-[13px] gap-2.5 rounded-2xl',
};

// ─── Icon-only size classes (mobile) ─────────────────────────────────────────

const mobileIconOnlyClasses: Record<ButtonSize, string> = {
  sm: 'h-11 w-11 rounded-xl',
  md: 'h-12 w-12 rounded-2xl',
  lg: 'h-14 w-14 rounded-2xl',
};

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * PrimaryButton — mode-aware button primitive.
 *
 * Desktop behavior:
 *   - Standard sizes, label always visible
 *   - Hover states, keyboard-friendly
 *
 * Mobile behavior:
 *   - All sizes promoted to meet 44px minimum touch target
 *   - `iconOnly` hides the label (icon + aria-label only)
 *   - Slightly larger border radius for iOS feel
 *   - `active:` states instead of `hover:` (touch feedback)
 *
 * Accessibility:
 *   - When `iconOnly`, the `label` prop is used as `aria-label`
 *   - Loading state disables interaction and shows a spinner
 *   - Uses native `<button>` element
 */
export function PrimaryButton({
  label,
  icon,
  trailingIcon,
  tone = 'primary',
  size = 'md',
  iconOnly = false,
  isLoading = false,
  disabled = false,
  className = '',
  type = 'button',
  ...rest
}: PrimaryButtonProps) {
  const { isMobile } = useUIModeOptional();
  const isIconOnly = isMobile && iconOnly && icon;

  const sizeClass = isIconOnly
    ? mobileIconOnlyClasses[size]
    : isMobile
      ? mobileSizeClasses[size]
      : desktopSizeClasses[size];

  return (
    <button
      type={type}
      disabled={disabled || isLoading}
      aria-label={isIconOnly ? label : undefined}
      className={`
        inline-flex items-center justify-center
        font-black uppercase tracking-wider
        transition-all duration-100 ease-out
        disabled:opacity-40 disabled:cursor-not-allowed
        active:scale-[0.97]
        ${toneClasses[tone]}
        ${sizeClass}
        ${className}
      `.trim()}
      {...rest}
    >
      {isLoading ? (
        <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <>
          {icon && (
            <span className={`flex-shrink-0 flex items-center justify-center ${isMobile ? 'h-5 w-5' : 'h-4 w-4'}`}>
              {icon}
            </span>
          )}
          {!isIconOnly && (
            <span className="whitespace-nowrap">{label}</span>
          )}
          {trailingIcon && !isIconOnly && (
            <span className="flex-shrink-0 flex items-center justify-center h-4 w-4">
              {trailingIcon}
            </span>
          )}
        </>
      )}
    </button>
  );
}
