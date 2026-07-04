'use client';

import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

type IconButtonTone = 'neutral' | 'accent';

const toneClassName: Record<IconButtonTone, string> = {
  neutral: 'text-text-soft hover:text-text-default',
  accent: 'text-text-soft hover:text-blue-600',
};

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick' | 'title'> {
  icon: ReactNode;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  ariaLabel: string;
  title?: string;
  tone?: IconButtonTone;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    onClick,
    className = '',
    ariaLabel,
    title,
    tone = 'neutral',
    disabled = false,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={[
        'transition-colors duration-100 ease-out active:scale-95 disabled:cursor-not-allowed disabled:opacity-35',
        toneClassName[tone],
        className,
      ].join(' ').trim()}
      {...rest}
    >
      {icon}
    </button>
  );
});
