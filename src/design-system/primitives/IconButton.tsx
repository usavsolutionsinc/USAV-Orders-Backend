'use client';

import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';

type IconButtonTone = 'neutral' | 'accent';

const toneClassName: Record<IconButtonTone, string> = {
  neutral: 'text-gray-500 hover:text-gray-900',
  accent: 'text-gray-500 hover:text-blue-600',
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

export function IconButton({
  icon,
  onClick,
  className = '',
  ariaLabel,
  title,
  tone = 'neutral',
  disabled = false,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
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
}
