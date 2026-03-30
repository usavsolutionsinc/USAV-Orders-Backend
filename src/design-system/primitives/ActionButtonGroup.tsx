'use client';

import type { ReactNode, MouseEvent } from 'react';

export interface ActionButtonItem {
  key: string;
  icon: ReactNode;
  ariaLabel: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  variant?: 'neutral' | 'accent' | 'danger';
}

export interface ActionButtonGroupProps {
  actions: ActionButtonItem[];
  className?: string;
}

const variantClass: Record<string, string> = {
  neutral: 'text-gray-400 hover:text-gray-600',
  accent: 'text-gray-400 hover:text-purple-600',
  danger: 'text-gray-400 hover:text-red-600',
};

/**
 * Row of icon-only action buttons with consistent spacing and hover states.
 * Use for inline actions in cards, rows, and panels (copy, edit, external link, etc.).
 */
export function ActionButtonGroup({ actions, className = '' }: ActionButtonGroupProps) {
  return (
    <div className={`flex items-center gap-1 ${className}`.trim()}>
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          aria-label={action.ariaLabel}
          className={`flex-shrink-0 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            variantClass[action.variant || 'neutral']
          }`}
        >
          {action.icon}
        </button>
      ))}
    </div>
  );
}
