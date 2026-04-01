'use client';

import React from 'react';

export function OperationsHeader({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-50 w-full bg-white border-b border-slate-200 shadow-sm">
      <div className="h-11 px-4 flex items-center">
        <h2 className="text-[13px] font-black tracking-tight text-slate-900 uppercase">
          {title} <span className="text-slate-400 font-medium ml-1">/ Operations</span>
        </h2>
      </div>
    </header>
  );
}
