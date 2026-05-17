'use client';

import type { ReactNode } from 'react';

interface AdminEmptyDetailProps {
  title: string;
  hint?: string;
  icon?: ReactNode;
}

export function AdminEmptyDetail({ title, hint, icon }: AdminEmptyDetailProps) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gray-50">
      <div className="flex max-w-xs flex-col items-center gap-3 text-center">
        {icon ? (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-gray-400 shadow-sm">
            {icon}
          </div>
        ) : null}
        <p className="text-[13px] font-bold text-gray-700">{title}</p>
        {hint ? <p className="text-[11px] text-gray-500">{hint}</p> : null}
      </div>
    </div>
  );
}
