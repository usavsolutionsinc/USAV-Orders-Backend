'use client';

import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center space-y-4 py-12 ${className}`}>
      {icon && (
        <div className="w-16 h-16 bg-surface-canvas rounded-full flex items-center justify-center border border-border-hairline">
          {icon}
        </div>
      )}
      <div className="space-y-2">
        <h3 className="text-lg font-black text-text-default">{title}</h3>
        {description && (
          <p className="text-sm text-text-soft max-w-sm">{description}</p>
        )}
      </div>
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
