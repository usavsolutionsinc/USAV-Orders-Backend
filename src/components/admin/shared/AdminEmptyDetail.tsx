'use client';

import type { ReactNode } from 'react';

interface AdminEmptyDetailProps {
  title: string;
  hint?: string;
  icon?: ReactNode;
}

export function AdminEmptyDetail({ title, hint, icon }: AdminEmptyDetailProps) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface-canvas">
      <div className="flex max-w-xs flex-col items-center gap-3 text-center">
        {icon ? (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-card text-text-faint shadow-sm">
            {icon}
          </div>
        ) : null}
        <p className="text-sm font-bold text-text-muted">{title}</p>
        {hint ? <p className="text-caption text-text-soft">{hint}</p> : null}
      </div>
    </div>
  );
}
