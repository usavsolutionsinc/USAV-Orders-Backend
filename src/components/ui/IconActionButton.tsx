'use client';

import type { ReactNode } from 'react';

export interface IconActionButtonProps {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  className?: string;
}

export function IconActionButton({ label, icon, onClick, className = '' }: IconActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-600 transition hover:bg-gray-50 hover:text-gray-900 ${className}`}
    >
      {icon}
    </button>
  );
}

