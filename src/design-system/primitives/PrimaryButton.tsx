'use client';

import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from './Button';

// ─── Types ───────────────────────────────────────────────────────────────────

type ButtonTone = 'primary' | 'secondary' | 'danger' | 'ghost';

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
  /** Size — `md` is default. Mobile mode auto-promotes for touch targets. */
  size?: ButtonSize;
  /** On mobile, show only the icon (label becomes aria-label). Requires `icon`. */
  iconOnly?: boolean;
  /** Loading state — shows spinner, disables interaction. */
  isLoading?: boolean;
}

// `tone` and `Button`'s `variant` share names (no `brand` tone), so this is a direct map.
const toneToVariant: Record<ButtonTone, ButtonVariant> = {
  primary: 'primary',
  secondary: 'secondary',
  danger: 'danger',
  ghost: 'ghost',
};

/**
 * PrimaryButton — label-based adapter over the canonical {@link Button} primitive.
 *
 * Retained for the existing call sites that pass `label`/`tone`/`isLoading`.
 * **New code should use `Button` directly** (children API, plus the `brand` variant).
 */
export function PrimaryButton({
  label,
  icon,
  trailingIcon,
  tone = 'primary',
  size = 'md',
  iconOnly = false,
  isLoading = false,
  ...rest
}: PrimaryButtonProps) {
  return (
    <Button
      variant={toneToVariant[tone]}
      size={size}
      icon={icon}
      iconRight={trailingIcon}
      iconOnly={iconOnly}
      loading={isLoading}
      ariaLabel={label}
      {...rest}
    >
      {label}
    </Button>
  );
}
